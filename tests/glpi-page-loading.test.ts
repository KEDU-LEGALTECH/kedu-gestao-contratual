import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {GlpiPage} from '../src/GlpiPage.js';

test('initial loading and unrelated busy state never claim demo mode or active synchronization',()=>{
 const html=renderToStaticMarkup(React.createElement(GlpiPage,{data:{sync:[],schools:[],demands:[]},can:()=>true,action:async()=>{},api:async()=>({}),busy:true,open:()=>{}}));
 assert.match(html,/Verificando integração/);
 assert.match(html,/Carregando agendamento/);
 assert.doesNotMatch(html,/Demonstração|Sincronizando/);
 assert.match(html,/aria-busy="false"/);
});
