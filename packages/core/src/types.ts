export type Kind = 'knowledge' | 'jobs' | 'resumes' | 'interviews';
type Base = {
  id: string;
  schemaVersion: 1;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type Knowledge = Base & { title: string; content: string; tags: string[] };
export type JobStatus = 'saved' | 'applied' | 'test' | 'interview' | 'offer' | 'closed';
export type Job = Base & {
  company: string;
  title: string;
  jd: string;
  url: string;
  location: string;
  status: JobStatus;
  deadline: string;
  interviewAt: string;
  notes: string;
  resumeId: string;
  resumeVersion: number | null;
};
export type Resume = Base & { title: string; source: string; version: number };
export type Message = { id: string; role: 'interviewer' | 'candidate'; content: string };
export type DimensionName = '技术知识' | '项目深度' | '问题分析' | '表达结构';
export type Review = {
  summary: string;
  strengths: string[];
  improvements: string[];
  dimensions: { name: DimensionName; score: number | null; evidence: string[] }[];
  rubricVersion: 1;
};
export type Interview = Base & {
  title: string;
  jobId: string;
  resumeId: string;
  resumeVersion: number | null;
  contextSnapshot: string;
  mode: 'mock' | 'real';
  status: 'active' | 'completed';
  messages: Message[];
  review: Review | null;
};
export type Profile = {
  name: string;
  email: string;
  phone: string;
  education: string;
  experience: string;
  skills: string;
  updatedAt: string;
  revision: number;
};
export type RecordMap = { knowledge: Knowledge; jobs: Job; resumes: Resume; interviews: Interview };
export type SearchHit = {
  id: string;
  title: string;
  excerpt: string;
  score: number;
  paragraph: number;
};

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const resumeTemplate = String.raw`\documentclass[UTF8]{ctexart}
\usepackage[margin=1.8cm]{geometry}
\pagestyle{empty}
\begin{document}
\section*{个人简历}
请在此填写简历内容。
\end{document}`;
