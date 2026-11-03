import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sameFieldValue,distinctFieldValues} from '../shared/value-comparison.js';
test('pontuação, acentos, caixa e caracteres tipográficos não criam divergência',()=>{
 const pairs=[
  ['cidade','“Itaguaí”.','ITAGUAI'],
  ['cidade','São Paulo,','SAO PAULO'],
  ['razaoSocial','“ESCOLA — RENASCER, LTDA.”','Escola Renascer Ltda'],
  ['nomeFantasia','Escolinha Pequenos Passos;','ESCOLINHA PEQUENOS PASSOS'],
  ['titularConta','P. O. PLÁCIDO ESCOLA TRAVESSIA LTDA.','P O PLACIDO ESCOLA TRAVESSIA LTDA'],
  ['cnpj','“00.817.900/0001–26”.','00817900000126'],
  ['representanteCpf','529.982.247–25.','52998224725'],
  ['cep','23.815–550.','23815550'],
  ['estado','Estado de São Paulo.','SP'],
  ['conta','68146786−2.','681467862'],
  ['conta','68.146.786/2','68146786-2'],
  ['conta','12345-X','12345x'],
  ['agencia','0001–2.','1-2'],
 ];
 for(const [key,a,b] of pairs)assert.equal(sameFieldValue(key,a,b),true,`${key}: ${a} / ${b}`);
});
test('diferenças reais de empresa, dígitos, conta ou titular continuam divergentes',()=>{
 const pairs=[
  ['razaoSocial','CENTRO EDUCACIONAL JOSE DE ALENCAR LTDA','ORGANIZAÇÃO EDUCACIONAL JOSÉ DE ALENCAR LTDA - COLÉGIO J.A. BABY'],
  ['nomeFantasia','ESCOLA RENASCER 1','ESCOLA RENASCER 2'],
  ['titularConta','MARIA DA SILVA','MARIO DA SILVA'],
  ['cnpj','00.817.900/0001-26','00.817.900/0001-27'],
  ['representanteCpf','529.982.247-25','529.982.247-26'],
  ['conta','68146786-2','68146786-3'],
  ['conta','068146786-2','68146786-2'],
  ['conta','12345-X','12345-0'],
  ['conta','12345?6','123456'],
  ['agencia','0001-2','0001-3'],
  ['cidade','Itaguaí','Itajaí'],
  ['banco','Nubank 341','Nubank'],
 ];
 for(const [key,a,b] of pairs)assert.equal(sameFieldValue(key,a,b),false,`${key}: ${a} / ${b}`);
 assert.equal(sameFieldValue('banco','0260','Nubank'),true);
 assert.deepEqual(distinctFieldValues('conta',['68146786-2','681467862','68146786-3']),['68146786-2','68146786-3']);
});
