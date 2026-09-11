#!/usr/bin/env node
/**
 * Generates .toto/drs-config.json and .toto/freeze.json from .toto/config.yml
 * Run via: pnpm generate:drs-config
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, '.toto', 'config.yml');
const DRS_CONFIG_PATH = path.join(ROOT, '.toto', 'drs-config.json');
const FREEZE_PATH = path.join(ROOT, '.toto', 'freeze.json');

function loadConfig(): any {
  const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return yaml.load(content);
}

function main() {
  const config = loadConfig();
  const drs = config.drs || {};

  // Generate drs-config.json
  const drsConfig = {
    allowed_paths: drs.allowed_paths || [],
    tenant_namespaces: drs.tenant_namespaces || [],
    current_tenant: drs.current_tenant || '',
    halt_patterns: drs.halt_patterns || [],
    // Only emit permissive when explicitly set — DRSService.ts's loadConfig()
    // treats its absence as false (fail-closed default), and this must
    // reach the generated runtime config for the config.yml documentation
    // comment on this field to have any actual effect.
    ...(typeof drs.permissive === 'boolean' ? { permissive: drs.permissive } : {}),
  };
  fs.writeFileSync(DRS_CONFIG_PATH, JSON.stringify(drsConfig, null, 2));
  console.log(`Generated ${DRS_CONFIG_PATH}`);

  // Generate freeze.json
  const freeze = { frozen: drs.freeze_paths || [] };
  fs.writeFileSync(FREEZE_PATH, JSON.stringify(freeze, null, 2));
  console.log(`Generated ${FREEZE_PATH}`);
}

main();