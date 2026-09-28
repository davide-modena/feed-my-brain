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
    attualita: number;
    perTopic: number;
    storia: number;
    curiosita: number;
    quizPerCard: number;
  };
  news: FeedConfig[];
  topics: TopicConfig[];
  history: { topics: string[] };
}

export function loadConfig(path = new URL('../config.yaml', import.meta.url)): Config {
  return parse(readFileSync(path, 'utf8')) as Config;
}
