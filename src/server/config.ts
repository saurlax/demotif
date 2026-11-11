import { dirname } from 'node:path';
import { loadConfiguration } from './settings';

// Next loads the server-only environment. Model routing and credentials stay here.
export const repositoryRoot = process.cwd();
export const config = loadConfiguration(repositoryRoot);
export const databaseDirectory = dirname(config.database);
