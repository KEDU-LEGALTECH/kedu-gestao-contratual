import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ProcessingProgress} from '../src/ProcessingProgress.js';
test('painel permanece visível e explica acesso restrito em vez de desaparecer',()=>{
 const html=renderToStaticMarkup(React.createElement(ProcessingProgress,{demands:[],api:async()=>({}),allowed:false}));
 assert.match(html,/Andamento da leitura/);assert.match(html,/perfil não tem permissão/);assert.ok(!html.includes('Consultando processamento'));
});
test('perfil autorizado vê o painel imediatamente enquanto os dados carregam',()=>{
 const html=renderToStaticMarkup(React.createElement(ProcessingProgress,{demands:[],api:async()=>({}),allowed:true}));
 assert.match(html,/Andamento da leitura/);assert.match(html,/Consultando processamento/);
});
