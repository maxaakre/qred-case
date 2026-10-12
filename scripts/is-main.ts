import { pathToFileURL } from 'node:url';

/**
 * True when the module is the script being run, not imported. Compares URLs, so
 * paths with spaces or other encoded characters still match.
 */
export const isMain = (moduleUrl: string) =>
  process.argv[1] !== undefined && moduleUrl === pathToFileURL(process.argv[1]).href;
