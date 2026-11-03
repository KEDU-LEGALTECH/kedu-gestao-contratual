import {test} from 'node:test';
import assert from 'node:assert/strict';
import {guidedConfirmation} from '../server/guided-confirmation.js';

const file=(name:string,text:string,problem='')=>({name,problem,extracted:JSON.stringify({text})});
test('valor exato do GLPI impresso no anexo é localizado com a origem',()=>{
 const files=[file('Contrato.pdf','LOCADORA: RENATO DE LIMA MESQUITA JUNIOR - ME, inscrita no CNPJ 12.408.334/0001-88')];
 assert.equal(guidedConfirmation('razaoSocial','RENATO DE LIMA MESQUITA JUNIOR - ME',files)?.source,'Contrato.pdf');
 assert.equal(guidedConfirmation('cnpj','12.408.334/0001-88',files)?.value,'12.408.334/0001-88');
});
test('nome do GLPI que é só o começo de um nome maior não é confirmado',()=>{
 const files=[file('Contrato.pdf','CONTRATANTE\nESCOLA LUZ DO SABER MOTESSORI LTDA, SOCIEDADE')];
 assert.equal(guidedConfirmation('razaoSocial','ESCOLA LUZ DO SABER',files),undefined);
 assert.equal(guidedConfirmation('razaoSocial','LUZ DO SABER MOTESSORI LTDA',files),undefined);
 assert.equal(guidedConfirmation('razaoSocial','ESCOLA LUZ DO SABER MOTESSORI LTDA',files)?.source,'Contrato.pdf');
});
test('nomes genéricos, CNPJ inválido e dígitos de outro número não confirmam',()=>{
 const files=[file('Contrato.pdf','ESCOLA LTDA\nCNPJ 12.408.334/0001-89\nTelefone 1240833400018')];
 assert.equal(guidedConfirmation('razaoSocial','ESCOLA LTDA',files),undefined);
 assert.equal(guidedConfirmation('cnpj','12.408.334/0001-89',files),undefined);
 assert.equal(guidedConfirmation('cnpj','12.408.334/0001-88',files),undefined);
});
test('titular bancário só vem de documento bancário; arquivos com falha, relatórios e campos fracos são ignorados',()=>{
 const contract=file('Contrato social.pdf','SÓCIA: MARIA DAS GRAÇAS SOUZA, CPF 529.982.247-25');
 assert.equal(guidedConfirmation('titularConta','MARIA DAS GRAÇAS SOUZA',[contract]),undefined);
 assert.equal(guidedConfirmation('documentoTitular','529.982.247-25',[contract]),undefined);
 assert.equal(guidedConfirmation('representanteCpf','529.982.247-25',[contract])?.source,'Contrato social.pdf');
 assert.equal(guidedConfirmation('razaoSocial','MARIA DAS GRAÇAS SOUZA',[file('x.png','MARIA DAS GRAÇAS SOUZA','Nenhum texto legível')]),undefined);
 assert.equal(guidedConfirmation('cidade','Maceió',[file('a.pdf','Maceió')]),undefined);
});
test('valor junto ao rótulo do campo fica associado; sem rótulo continua a conferir',()=>{
 const social=file('Alteração.pdf','PASSANDO A ADOTAR O NOME EMPRESARIAL M. S. RAMOS BRINQUEDOTECA LTDA, E A MANTER O NOME FANTASIA ESCOLA E BRINQUEDOTECA GENTE MIUDA.\nCNPJ DA SEDE: 11.444.777/0001-61');
 assert.equal(guidedConfirmation('razaoSocial','M. S. RAMOS BRINQUEDOTECA LTDA',[social])?.associated,true);
 assert.equal(guidedConfirmation('nomeFantasia','ESCOLA E BRINQUEDOTECA GENTE MIUDA',[social])?.associated,true);
 assert.equal(guidedConfirmation('cnpj','11.444.777/0001-61',[social])?.associated,true);
 const header=file('Ordem de serviço.pdf','Página 1/1\nKAIROS LOCAÇÃO DE EQUIPAMENTOS ÁUDIO VISUAL\nJailton Oliveira');
 assert.equal(guidedConfirmation('razaoSocial','Kairos Locação De Equipamentos Áudio Visual',[header])?.associated,false);
});
test('nome fantasia não comprova razão social e vice-versa',()=>{
 const contract=file('Contrato.docx','inscrita no CNPJ: sob nº 32.105.940/0001-31, sob nome fantasia ALFABETHUS CENTRO EDUCACIONAL – CONTRATURNO');
 assert.equal(guidedConfirmation('razaoSocial','ALFABETHUS CENTRO EDUCACIONAL',[contract])?.associated,false);
 assert.equal(guidedConfirmation('nomeFantasia','ALFABETHUS CENTRO EDUCACIONAL',[contract])?.associated,true);
 const qualified=file('Contrato.pdf','HOTEL CONCORD EIRELI, pessoa jurídica de direito privado');
 assert.equal(guidedConfirmation('razaoSocial','HOTEL CONCORD EIRELI',[qualified])?.associated,true);
 assert.equal(guidedConfirmation('nomeFantasia','HOTEL CONCORD EIRELI',[qualified])?.associated,false);
});
test('CEP de residência de sócio não comprova o CEP da empresa',()=>{
 const home=file('Alteração.pdf','RAIMUNDO, brasileiro, casado, residente na Rua X, Parauapebas, CEP:68.515-000, Brasil');
 assert.equal(guidedConfirmation('cep','68515-000',[home])?.associated,false);
 const seat=file('Contrato social.pdf','A sociedade tem sede e domicílio na Rua Dr Celestino, 40 – Centro - Itaguaí - RJ, CEP: 23815-550');
 assert.equal(guidedConfirmation('cep','23815-550',[seat])?.associated,true);
});
test('layout de colunas, nome quebrado em linhas e cartão CNPJ mantêm a associação',()=>{
 const contract=file('Contrato.pdf','LOCADORA: RENATO DE LIMA MESQUITA JUNIOR - ME   FUNCIONÁRIO(A):\nfazem de um lado a RENATO DE LIMA MESQUITA\nJUNIOR - ME, Inscrita no CNPJ/MF');
 assert.equal(guidedConfirmation('razaoSocial','RENATO DE LIMA MESQUITA JUNIOR - ME',[contract])?.associated,true);
 const card=file('cartão.pdf','TÍTULO DO ESTABELECIMENTO (NOME DE FANTASIA) PORTE\nESCOLINHA TRAVESSIA DOM GUANELLA\nCODIGO E DESCRIÇÃO');
 assert.equal(guidedConfirmation('nomeFantasia','ESCOLINHA TRAVESSIA DOM GUANELLA',[card])?.associated,true);
 assert.equal(guidedConfirmation('razaoSocial','ESCOLINHA TRAVESSIA DOM GUANELLA',[card])?.associated,false);
});
