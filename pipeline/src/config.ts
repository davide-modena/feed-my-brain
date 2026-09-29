import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

export interface FeedConfig {
  name: string;
  url: string;
}

export interface TopicConfig {
  id: string;
  label: string;
  description: string;
  default?: boolean;
  queries?: { query: string; lang?: 'it' | 'en' }[];
  feeds?: FeedConfig[];
}

export interface Config {
  edition: {
    mondo: number;
    italia: number;
    perTopic: number;
    storia: number;
    curiosita: number;
    quizPerCard: number;
  };
  news: FeedConfig[];
  topics: TopicConfig[];
  /** Aree di Wikipedia (voci in vetrina e di qualità) da cui pescare le curiosità. */
  curiosities: { areas: string[] };
}

export function loadConfig(path = new URL('../config.yaml', import.meta.url)): Config {
  return parse(readFileSync(path, 'utf8')) as Config;
}
