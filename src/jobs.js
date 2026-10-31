import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

function now() {
  return new Date().toISOString();
}

export class JobQueue extends EventEmitter {
  constructor({ maxCompleted = 60, concurrency = 1 } = {}) {
    super();
    this.jobs = new Map();
    this.order = [];
    this.maxCompleted = maxCompleted;
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }

  create(type, title, runner, meta = {}) {
    const id = `job_${crypto.randomUUID().slice(0, 8)}`;
    const job = {
      id,
      type,
      title,
      status: 'queued',
      progress: { phase: 'queued', percent: 0, message: '等待执行…' },
      logs: [],
      createdAt: now(),
      startedAt: null,
      finishedAt: null,
      error: null,
      result: null,
      meta,
      controller: new AbortController(),
    };
    this.jobs.set(id, job);
    this.order.push(id);
    this.queue.push({ job, runner });
    this.emit('job', this.toJSON(job));
    this.pump();
    return this.toJSON(job);
  }

  pump() {
    while (this.running < this.concurrency && this.queue.length) {
      const entry = this.queue.shift();
      if (entry.job.controller.signal.aborted) continue;
      this.running += 1;
      this.run(entry).finally(() => {
        this.running -= 1;
        this.pump();
      });
    }
  }

  async run({ job, runner }) {
    job.status = 'running';
    job.startedAt = now();
    this.update(job, { phase: 'starting', percent: 2, message: '开始执行…' });
    const report = (progress = {}) => {
      if (job.status === 'cancelled') return;
      const previous = job.progress || {};
      const merged = { ...previous, ...progress };
      if (progress.current != null && progress.total) {
        merged.percent = Math.max(0, Math.min(99, Math.round((progress.current / progress.total) * 100)));
      }
      if (progress.percent != null) merged.percent = Math.max(0, Math.min(100, Number(progress.percent)));
      if (progress.message) {
        job.logs.push({ at: now(), message: String(progress.message), phase: merged.phase || null });
        if (job.logs.length > 400) job.logs.splice(0, job.logs.length - 400);
      }
      job.progress = merged;
      this.emit('job', this.toJSON(job));
    };
    try {
      const result = await runner({ job, report, signal: job.controller.signal });
      if (job.controller.signal.aborted) {
        job.status = 'cancelled';
        job.progress = { ...job.progress, phase: 'cancelled', message: '任务已取消', percent: 100 };
      } else {
        job.status = 'done';
        job.result = result ?? null;
        job.progress = { ...job.progress, phase: 'done', message: '任务完成', percent: 100 };
      }
    } catch (error) {
      if (job.controller.signal.aborted) {
        job.status = 'cancelled';
        job.progress = { ...job.progress, phase: 'cancelled', message: '任务已取消', percent: 100 };
      } else {
        job.status = 'failed';
        job.error = error?.message || String(error);
        job.progress = { ...job.progress, phase: 'failed', message: job.error, percent: 100 };
        job.logs.push({ at: now(), message: `失败：${job.error}`, phase: 'failed' });
      }
    } finally {
      job.finishedAt = now();
      this.emit('job', this.toJSON(job));
      this.cleanup();
    }
  }

  update(job, progress) {
    job.progress = { ...job.progress, ...progress };
    if (progress.message) {
      job.logs.push({ at: now(), message: String(progress.message), phase: progress.phase || null });
      if (job.logs.length > 400) job.logs.splice(0, job.logs.length - 400);
    }
    this.emit('job', this.toJSON(job));
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (['done', 'failed', 'cancelled'].includes(job.status)) return this.toJSON(job);
    job.controller.abort();
    if (job.status === 'queued') {
      job.status = 'cancelled';
      job.finishedAt = now();
      job.progress = { ...job.progress, phase: 'cancelled', message: '任务已取消', percent: 100 };
      this.emit('job', this.toJSON(job));
    }
    return this.toJSON(job);
  }

  cleanup() {
    const finished = this.order.filter((id) => ['done', 'failed', 'cancelled'].includes(this.jobs.get(id)?.status));
    while (finished.length > this.maxCompleted) {
      const id = finished.shift();
      this.jobs.delete(id);
      this.order = this.order.filter((existing) => existing !== id);
    }
  }

  get(id) {
    const job = this.jobs.get(id);
    return job ? this.toJSON(job) : null;
  }

  list() {
    return this.order.map((id) => this.toJSON(this.jobs.get(id))).filter(Boolean).reverse();
  }

  active() {
    return this.list().filter((job) => job.status === 'running' || job.status === 'queued');
  }

  toJSON(job) {
    if (!job) return null;
    return {
      id: job.id,
      type: job.type,
      title: job.title,
      status: job.status,
      progress: job.progress,
      logs: job.logs,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      error: job.error,
      result: job.result,
      meta: job.meta,
    };
  }
}
