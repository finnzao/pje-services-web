'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { DownloadJobResponse, PJEDownloadProgress, ParametrosDownload } from '../componentes/pje-download/types';
import { isJobActive } from '../componentes/pje-download/types';
import { criarJob, listarJobs, obterProgresso, cancelarJob } from '../componentes/pje-download/api';

export function useJobPoller(sessionId?: string) {
  const [jobs, setJobs] = useState<DownloadJobResponse[]>([]);
  const [mapaProgresso, setMapaProgresso] = useState<Record<string, PJEDownloadProgress>>({});
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  const recarregarJobs = useCallback(async () => {
    try { const data = await listarJobs(20, 0); setJobs(data.jobs || []); } catch { /* silent */ }
  }, []);

  const carregarProgresso = useCallback(async () => {
    const ativos = jobsRef.current.filter((j) => isJobActive(j.status));
    for (const job of ativos) {
      try { const p = await obterProgresso(job.id); if (p) setMapaProgresso((prev) => ({ ...prev, [job.id]: p })); } catch { /* silent */ }
    }
  }, []);

  const criarNovoJob = useCallback(async (params: ParametrosDownload, credenciais: { cpf: string; password: string }) => {
    const novoJob = await criarJob({ ...params, credentials: credenciais, pjeSessionId: sessionId });
    setJobs((prev) => [novoJob, ...prev]);
    return novoJob;
  }, [sessionId]);

  const cancelarJobById = useCallback(async (jobId: string) => {
    try { await cancelarJob(jobId); recarregarJobs(); } catch { /* silent */ }
  }, [recarregarJobs]);

  useEffect(() => {
    recarregarJobs();
    const interval = setInterval(() => {
      if (jobsRef.current.some((j) => isJobActive(j.status))) { recarregarJobs(); carregarProgresso(); }
    }, 10_000);
    return () => clearInterval(interval);
  }, [recarregarJobs, carregarProgresso]);

  return { jobs, mapaProgresso, criarNovoJob, cancelarJobById, recarregarJobs };
}
