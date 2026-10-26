"""Local image preparation and OCR. NDJSON over stdin/stdout; never accepts URLs."""
import base64
import contextlib
import json
import os
from pathlib import Path
import sys
import threading

sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

if os.name == "nt" and "--setup" not in sys.argv:
    # Windows does not terminate grandchildren when the bounded Node reader exits.
    import ctypes
    kernel = ctypes.windll.kernel32
    kernel.OpenProcess.restype = ctypes.c_void_p
    kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint]
    parent_handle = kernel.OpenProcess(0x00100000, False, os.getppid())
    if parent_handle:
        def parent_watchdog():
            kernel.WaitForSingleObject(parent_handle, 0xFFFFFFFF)
            os._exit(0)
        threading.Thread(target=parent_watchdog, daemon=True).start()

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "data" / "ocr-models"
if "--setup" in sys.argv:
    (ROOT / "data").mkdir(exist_ok=True)
    (ROOT / "data" / "ocr-runtime.json").write_text(json.dumps({"ready": False}), encoding="utf-8")
os.environ["PADDLE_PDX_CACHE_HOME"] = str(CACHE)
os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "2"
WIRE = sys.stdout
sys.stdout = sys.stderr

import cv2
import numpy as np
cv2.setNumThreads(2)


def prepare(image):
    """Conservative perspective correction, small-angle deskew and shadow reduction."""
    if image is None or image.size == 0 or image.shape[0] * image.shape[1] > 24000000:
        raise ValueError("Imagem inválida ou maior que 24 megapixels.")
    operations = []
    height, width = image.shape[:2]
    scale = min(1.0, 1400 / max(width, height))
    small = cv2.resize(image, None, fx=scale, fy=scale)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 50, 150)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    area = small.shape[0] * small.shape[1]
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:8]:
        polygon = cv2.approxPolyDP(contour, .02 * cv2.arcLength(contour, True), True)
        # Avoid cropping individual tables/boxes; only an almost full-page boundary qualifies.
        if len(polygon) != 4 or not cv2.isContourConvex(polygon) or cv2.contourArea(polygon) < .72 * area:
            continue
        points = polygon.reshape(4, 2).astype("float32") / scale
        ordered = np.zeros((4, 2), dtype="float32")
        sums, differences = points.sum(axis=1), np.diff(points, axis=1).ravel()
        ordered[0], ordered[2] = points[sums.argmin()], points[sums.argmax()]
        ordered[1], ordered[3] = points[differences.argmin()], points[differences.argmax()]
        if len(np.unique(ordered, axis=0)) != 4:
            continue
        tl, tr, br, bl = ordered
        target_w = int(max(np.linalg.norm(br-bl), np.linalg.norm(tr-tl)))
        target_h = int(max(np.linalg.norm(tr-br), np.linalg.norm(tl-bl)))
        if min(target_w, target_h) < 100 or target_w * target_h > 24000000:
            continue
        matrix = cv2.getPerspectiveTransform(ordered, np.float32([[0, 0], [target_w-1, 0], [target_w-1, target_h-1], [0, target_h-1]]))
        image = cv2.warpPerspective(image, matrix, (target_w, target_h), borderValue=(255, 255, 255))
        operations.append("perspectiva")
        break
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    lines = cv2.HoughLinesP(cv2.Canny(gray, 50, 150), 1, np.pi/1800,
                            threshold=max(40, image.shape[1]//8),
                            minLineLength=max(80, image.shape[1]//3), maxLineGap=20)
    angles = []
    for item in lines if lines is not None else []:
        x1, y1, x2, y2 = item[0]
        angle = np.degrees(np.arctan2(y2-y1, x2-x1))
        if abs(angle) < 8:
            angles.append(angle)
    if len(angles) >= 4 and .3 < abs(float(np.median(angles))) < 8:
        angle = float(np.median(angles))
        h, w = image.shape[:2]
        matrix = cv2.getRotationMatrix2D((w/2, h/2), angle, 1)
        cosine, sine = abs(matrix[0, 0]), abs(matrix[0, 1])
        out_w, out_h = int(h*sine+w*cosine), int(h*cosine+w*sine)
        if out_w*out_h <= 24000000:
            matrix[0, 2] += out_w/2-w/2
            matrix[1, 2] += out_h/2-h/2
            image = cv2.warpAffine(image, matrix, (out_w, out_h), borderValue=(255, 255, 255))
            operations.append("alinhamento")
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    background = cv2.GaussianBlur(gray, (0, 0), 25)
    corrected = cv2.divide(gray, np.maximum(background, 1), scale=255)
    corrected = cv2.createCLAHE(clipLimit=1.5, tileGridSize=(8, 8)).apply(corrected)
    operations.append("sombras e contraste local")
    return cv2.cvtColor(corrected, cv2.COLOR_GRAY2BGR), operations


def make_pipeline():
    from paddleocr import PaddleOCR
    local = {} if "--setup" in sys.argv else {
        "doc_orientation_classify_model_dir": str(CACHE / "official_models" / "PP-LCNet_x1_0_doc_ori"),
        "text_detection_model_dir": str(CACHE / "official_models" / "PP-OCRv5_mobile_det"),
        "text_recognition_model_dir": str(CACHE / "official_models" / "latin_PP-OCRv5_mobile_rec"),
    }
    if local and any(not Path(directory).is_dir() for directory in local.values()):
        raise RuntimeError("Modelos locais ausentes. Execute a preparação do OCR.")
    return PaddleOCR(lang="pt", ocr_version="PP-OCRv5", device="cpu",
                     text_detection_model_name="PP-OCRv5_mobile_det",
                     text_recognition_model_name="latin_PP-OCRv5_mobile_rec",
                     use_doc_orientation_classify=True, use_doc_unwarping=False,
                     use_textline_orientation=False, enable_mkldnn=True, cpu_threads=2,
                     text_recognition_batch_size=16, text_det_limit_side_len=1600,
                     text_det_limit_type="max", **local)


def recognize(pipeline, image):
    output = []
    for result in pipeline.predict(image, use_doc_orientation_classify=image.shape[1] < 3*image.shape[0]):
        payload = result.json
        payload = payload.get("res", payload)
        texts = payload.get("rec_texts", [])
        scores = payload.get("rec_scores", [])
        boxes = payload.get("rec_polys", payload.get("dt_polys", []))
        for text, score, polygon in zip(texts, scores, boxes):
            if text.strip() and float(score) >= .45:
                points = np.asarray(polygon)
                output.append({"text": text, "confidence": round(float(score)*100, 2),
                               "box": [float(points[:, 0].min()), float(points[:, 1].min()),
                                       float(points[:, 0].max()), float(points[:, 1].max())]})
    return output


def main():
    with contextlib.redirect_stdout(sys.stderr):
        pipeline = make_pipeline()
    if "--setup" in sys.argv:
        # Actual inference verifies native libraries and downloaded models before activation.
        sample = np.full((160, 800, 3), 255, dtype=np.uint8)
        cv2.putText(sample, "CNPJ 11.444.777/0001-61", (20, 90), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 0), 2)
        if not recognize(pipeline, sample):
            raise RuntimeError("O teste de inferência não reconheceu o texto de exemplo.")
        (ROOT / "data" / "ocr-runtime.json").write_text(json.dumps({"ready": True, "python": sys.executable, "engine": "PP-OCRv5", "opencv": cv2.__version__}), encoding="utf-8")
        print(json.dumps({"ready": True, "opencv": cv2.__version__}), file=WIRE, flush=True)
        return
    for raw in sys.stdin:
        try:
            if len(raw) > 30000000:
                raise ValueError("Imagem excede o limite de entrada.")
            request = json.loads(raw)
            encoded = base64.b64decode(request["image"], validate=True)
            if len(encoded) > 20*1024*1024:
                raise ValueError("Imagem maior que 20 MB.")
            original = cv2.imdecode(np.frombuffer(encoded, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
            if original is None:
                raise ValueError("Imagem não reconhecida.")
            if len(original.shape) == 2:
                original = cv2.cvtColor(original, cv2.COLOR_GRAY2BGR)
            elif original.shape[2] == 4:
                alpha = original[:, :, 3:4].astype(np.float32) / 255
                original = (original[:, :, :3]*alpha + 255*(1-alpha)).astype(np.uint8)
            if os.environ.get("OCR_DIAGNOSTICS") == "1":
                print("OCR: imagem decodificada", file=sys.stderr, flush=True)
            prepared, operations = prepare(original)
            if os.environ.get("OCR_DIAGNOSTICS") == "1":
                print("OCR: imagem preparada", file=sys.stderr, flush=True)
            with contextlib.redirect_stdout(sys.stderr):
                first = recognize(pipeline, original)
                if os.environ.get("OCR_DIAGNOSTICS") == "1":
                    print("OCR: primeira leitura concluída", file=sys.stderr, flush=True)
                second = recognize(pipeline, prepared)
            response = {"passes": [first, second], "operations": operations, "engine": "PaddleOCR PP-OCRv5 + OpenCV"}
        except Exception as error:
            response = {"error": str(error)[:400]}
        print(json.dumps(response, ensure_ascii=False), file=WIRE, flush=True)


if __name__ == "__main__":
    main()
