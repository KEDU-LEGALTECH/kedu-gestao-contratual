import { randomUUID } from "node:crypto";
import type postgres from "postgres";

type Job = { demand_id: string; ticket_hash: string; attempts: number; progress: number; last_error: string };
const day = 24 * 3600000;

/** Database operations for the PostgreSQL worker. Construction does not recover or run jobs. */
export class PostgresReadingQueue {
  private readonly owner = randomUUID();
  constructor(private readonly sql: postgres.Sql, private readonly time = Date.now) {}

  private async serialize(tx: postgres.TransactionSql) {
    await tx`SELECT pg_advisory_xact_lock(hashtext(current_schema() || '.kedu_reading_queue')::bigint)`;
  }

  async enqueue(demand: string, hash: string, reopenCompleted = false, reopenFailed = false) {
    const now = this.time();
    await this.sql.begin(async tx => {
      await this.serialize(tx);
      await tx`UPDATE reading_jobs SET state='superseded',updated=${now} WHERE demand_id=${demand}
        AND ticket_hash<>${hash} AND state IN ('queued','retry')`;
      await tx`INSERT INTO reading_jobs(demand_id,ticket_hash,state,available_at,updated)
        VALUES(${demand},${hash},'queued',${now},${now}) ON CONFLICT(demand_id,ticket_hash) DO NOTHING`;
      if (reopenCompleted) await tx`UPDATE reading_jobs SET state='queued',attempts=0,available_at=${now},
        updated=${now},last_error='targeted-fields' WHERE demand_id=${demand} AND ticket_hash=${hash}
        AND state IN ('done','exhausted')`;
      if (reopenFailed) await tx`UPDATE reading_jobs SET state='queued',attempts=0,available_at=${now},
        updated=${now},last_error='' WHERE demand_id=${demand} AND ticket_hash=${hash}
        AND (state='done' OR (state='exhausted' AND updated<=${now-day}))`;
    });
  }

  async claim(): Promise<Job | undefined> {
    const now = this.time();
    return this.sql.begin(async tx => {
      await this.serialize(tx);
      const [job] = await tx`UPDATE reading_jobs SET state='running',owner=${this.owner},attempts=attempts+1,updated=${now}
        WHERE (demand_id,ticket_hash)=(SELECT demand_id,ticket_hash FROM reading_jobs WHERE state IN ('queued','retry')
          AND available_at<=${now} ORDER BY available_at,demand_id,ticket_hash LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM reading_jobs WHERE state='running')
        RETURNING demand_id,ticket_hash,attempts,progress,last_error`;
      if (!job) return;
      return { demand_id:job.demand_id, ticket_hash:job.ticket_hash, attempts:Number(job.attempts),
        progress:Number(job.progress), last_error:job.last_error };
    });
  }

  async finish(job: Job, outcome: "done" | "retry" | "superseded", reason = "", progress = job.progress, temporary = false) {
    if (outcome === "retry" && job.last_error === "targeted-fields") reason = "targeted-fields";
    const attempts = progress > job.progress ? 0 : temporary && outcome === "retry" ? Math.max(0,job.attempts-1) : job.attempts;
    const state = outcome === "retry" && attempts >= 3 ? "exhausted" : outcome;
    const now = this.time();
    const due = now + 600000 * 2 ** Math.max(0, attempts-1);
    const [finished] = await this.sql`UPDATE reading_jobs SET state=${state},attempts=${attempts},
      progress=greatest(progress,${progress}),available_at=${due},owner=NULL,updated=${now},last_error=${reason.slice(0,1000)}
      WHERE demand_id=${job.demand_id} AND ticket_hash=${job.ticket_hash} AND owner=${this.owner} AND state='running'
      RETURNING demand_id`;
    return Boolean(finished);
  }
}
