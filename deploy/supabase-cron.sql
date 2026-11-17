-- Agendamento do Kedu pelo próprio Supabase (pg_cron + pg_net), no lugar do Vercel Cron,
-- que no plano gratuito roda só uma vez por dia. Sem custo adicional no plano atual do Supabase.
--
-- Rode no SQL Editor do Supabase SÓ DEPOIS de o portal estar publicado na Vercel, trocando:
--   <ENDERECO>     pelo domínio de PRODUÇÃO do portal, sem https:// (ex.: kedu.vercel.app).
--                  Não use endereço de pré-visualização: ele exige login da Vercel.
--   <CRON_SECRET>  pelo mesmo valor cadastrado em CRON_SECRET nas variáveis da Vercel.
--
-- As rotas só agem quando há trabalho: a sincronização roda quando um horário de GLPI_SYNC_TIMES
-- (07:00, 12:00, 16:00 de Brasília) passou sem sincronização concluída; nas outras chamadas
-- responde "nada a fazer" em milissegundos. Uma sincronização interrompida pelo limite de
-- 300 s é completada na chamada seguinte.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Endereço e segredo ficam no cofre do Supabase, fora do código.
select vault.create_secret('<ENDERECO>', 'kedu_portal_host');
select vault.create_secret('<CRON_SECRET>', 'kedu_cron_secret');

-- Chama uma rota do portal com o segredo. pg_net não espera a resposta: a chamada segue na Vercel.
create or replace function public.kedu_call(route text) returns bigint
language sql security definer set search_path = '' as $$
  select net.http_get(
    url := 'https://' || (select decrypted_secret from vault.decrypted_secrets where name = 'kedu_portal_host') || route,
    headers := jsonb_build_object('Authorization', 'Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name = 'kedu_cron_secret')),
    timeout_milliseconds := 300000
  );
$$;
revoke all on function public.kedu_call(text) from public, anon, authenticated;

-- A cada 15 minutos (horários em UTC; a regra de 07h/12h/16h fica no portal).
select cron.schedule('kedu-glpi-sync', '*/15 * * * *', $$ select public.kedu_call('/api/cron/glpi-sync') $$);
-- Leitura dos arquivos digitais, defasada da sincronização.
select cron.schedule('kedu-reading', '7,22,37,52 * * * *', $$ select public.kedu_call('/api/cron/reading') $$);

-- Conferir:      select jobname, schedule, active from cron.job;
-- Últimas execuções: select status, return_message, start_time from cron.job_run_details order by start_time desc limit 20;
-- Respostas HTTP:    select status_code, content, created from net._http_response order by created desc limit 20;
-- Pausar tudo:   select cron.unschedule('kedu-glpi-sync'); select cron.unschedule('kedu-reading');
