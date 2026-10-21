-- Classify existing instruments without deleting or rewriting their history.
CREATE VIEW IF NOT EXISTS contract_registry AS
SELECT c.*,
 CASE WHEN EXISTS(SELECT 1 FROM demands d WHERE d.contract_id=c.id AND d.type IN
 ('CNPJ solidário','Antecipação K-invest','Parcelamento','Migração de modalidade','Distrato','Descredenciamento','Renovação com pendências','Alteração societária'))
 THEN 'Operação jurídica' WHEN c.parent_id IS NOT NULL THEN 'Aditivo' ELSE 'Matriz' END AS instrument_kind,
 (SELECT d.type FROM demands d WHERE d.contract_id=c.id AND d.type IN
 ('CNPJ solidário','Antecipação K-invest','Parcelamento','Migração de modalidade','Distrato','Descredenciamento','Renovação com pendências','Alteração societária') LIMIT 1) AS operation_type,
 (SELECT json_extract(d.data,'$.matriz') FROM demands d WHERE d.contract_id=c.id LIMIT 1) AS source_matrix
FROM contracts c;
