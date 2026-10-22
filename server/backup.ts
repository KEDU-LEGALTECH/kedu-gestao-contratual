import "dotenv/config";
import {createVerifiedBackup} from "./backup-service.js";
const result=await createVerifiedBackup();
console.log("Backup consistente criado e reaberto com sucesso: "+result.path);
console.log("Integridade e referências verificadas. Demandas recuperáveis: "+result.demands);
