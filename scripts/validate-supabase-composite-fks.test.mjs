import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsDirectory = join(repositoryRoot, 'supabase', 'migrations');
const originalMigrationFiles = [
  '202610290001_core_project_security.sql',
  '202610290002_paypal_invoice_workflow.sql',
  '202610300001_marketplace_profiles.sql',
  '202610300002_marketplace_jobs.sql',
  '202610300003_messaging_notifications.sql',
  '202610300004_hourly_workflows.sql',
  '202610300005_commercial_hardening.sql',
];

function normalizeIdentifier(identifier) {
  return identifier.trim().replaceAll('"', '').toLowerCase();
}

function normalizeRelation(relation) {
  const parts = relation.split('.').map(normalizeIdentifier);
  return parts.length === 1 ? `public.${parts[0]}` : parts.join('.');
}

function splitColumns(columns) {
  return columns.split(',').map(normalizeIdentifier);
}

function closingParenthesis(source, openingIndex) {
  let depth = 0;
  let quote = null;

  for (let index = openingIndex; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (quote === "'") {
      if (character === "'" && next === "'") {
        index += 1;
      } else if (character === "'") {
        quote = null;
      }
      continue;
    }

    if (quote === '"') {
      if (character === '"' && next === '"') {
        index += 1;
      } else if (character === '"') {
        quote = null;
      }
      continue;
    }

    if (character === '-' && next === '-') {
      index = source.indexOf('\n', index);
      if (index === -1) return -1;
      continue;
    }

    if (character === '/' && next === '*') {
      const commentEnd = source.indexOf('*/', index + 2);
      if (commentEnd === -1) return -1;
      index = commentEnd + 1;
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
    } else if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function splitTableItems(body) {
  const items = [];
  let start = 0;
  let depth = 0;
  let quote = null;

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    const next = body[index + 1];

    if (quote === "'") {
      if (character === "'" && next === "'") index += 1;
      else if (character === "'") quote = null;
      continue;
    }

    if (quote === '"') {
      if (character === '"' && next === '"') index += 1;
      else if (character === '"') quote = null;
      continue;
    }

    if (character === '-' && next === '-') {
      index = body.indexOf('\n', index);
      if (index === -1) break;
      continue;
    }

    if (character === '/' && next === '*') {
      const commentEnd = body.indexOf('*/', index + 2);
      if (commentEnd === -1) break;
      index = commentEnd + 1;
      continue;
    }

    if (character === "'" || character === '"') quote = character;
    else if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (character === ',' && depth === 0) {
      items.push(body.slice(start, index).trim());
      start = index + 1;
    }
  }

  const last = body.slice(start).trim();
  if (last) items.push(last);
  return items;
}

function stripConstraintName(item) {
  return item.replace(/^constraint\s+(?:"[^"]+"|[\w$]+)\s+/i, '');
}

function collectCreateTables(sql, filename, tables, foreignKeys) {
  const tablePattern = /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?((?:"?[a-z_][\w$]*"?\.)?"?[a-z_][\w$]*"?)\s*\(/gi;
  const relationPattern = /^(?:"?[a-z_][\w$]*"?\.)?"?[a-z_][\w$]*"?$/i;
  let match;

  while ((match = tablePattern.exec(sql)) !== null) {
    const relation = match[1];
    if (!relationPattern.test(relation)) continue;

    const openingIndex = tablePattern.lastIndex - 1;
    const closingIndex = closingParenthesis(sql, openingIndex);
    assert.notEqual(closingIndex, -1, `${filename}: unterminated CREATE TABLE for ${relation}`);

    const tableName = normalizeRelation(relation);
    const uniqueKeys = tables.get(tableName) ?? [];
    const body = sql.slice(openingIndex + 1, closingIndex);

    for (const rawItem of splitTableItems(body)) {
      const item = stripConstraintName(rawItem);
      const tableKey = item.match(/^(?:primary\s+key|unique)\s*\(([^)]+)\)/i);
      if (tableKey) uniqueKeys.push(splitColumns(tableKey[1]));

      const column = item.match(/^\s*("?[a-z_][\w$]*"?)\s+/i)?.[1];
      if (column && /\bprimary\s+key\b/i.test(item)) uniqueKeys.push([normalizeIdentifier(column)]);
      if (column && /\bunique\b/i.test(item)) uniqueKeys.push([normalizeIdentifier(column)]);

      const foreignKey = item.match(/\bforeign\s+key\s*\(([^)]+)\)\s*references\s+((?:"?[a-z_][\w$]*"?\.)?"?[a-z_][\w$]*"?)\s*\(([^)]+)\)/i);
      if (foreignKey) {
        foreignKeys.push({
          file: filename,
          source: tableName,
          columns: splitColumns(foreignKey[1]),
          target: normalizeRelation(foreignKey[2]),
          targetColumns: splitColumns(foreignKey[3])
        });
      }
    }

    tables.set(tableName, uniqueKeys);
    tablePattern.lastIndex = closingIndex + 1;
  }
}

function collectAlteredCompositeForeignKeys(sql, filename, foreignKeys) {
  const alterPattern = /\balter\s+table\s+((?:"?[a-z_][\w$]*"?\.)?"?[a-z_][\w$]*"?)\b([\s\S]*?);/gi;
  const constraintPattern = /\badd\s+constraint\s+(?:"[^"]+"|[\w$]+)\s+foreign\s+key\s*\(([^)]+)\)\s*references\s+((?:"?[a-z_][\w$]*"?\.)?"?[a-z_][\w$]*"?)\s*\(([^)]+)\)/gi;
  let alter;

  while ((alter = alterPattern.exec(sql)) !== null) {
    let constraint;
    while ((constraint = constraintPattern.exec(alter[2])) !== null) {
      const columns = splitColumns(constraint[1]);
      if (columns.length < 2) continue;
      foreignKeys.push({
        file: filename,
        source: normalizeRelation(alter[1]),
        columns,
        target: normalizeRelation(constraint[2]),
        targetColumns: splitColumns(constraint[3])
      });
    }
  }
}

function missingReferencedUniqueKeys(foreignKeys, tables) {
  return foreignKeys.flatMap((foreignKey) => {
    if (foreignKey.columns.length < 2 || foreignKey.targetColumns.length < 2) return [];
    if (!foreignKey.target.startsWith('public.')) return [];

    const targetKeys = tables.get(foreignKey.target) ?? [];
    const found = targetKeys.some((key) => key.length === foreignKey.targetColumns.length
      && key.every((column, index) => column === foreignKey.targetColumns[index]));

    return found ? [] : [{
      ...foreignKey,
      reason: `no PRIMARY KEY or UNIQUE constraint on ${foreignKey.target}(${foreignKey.targetColumns.join(', ')})`
    }];
  });
}

function readProjectMigrations() {
  const filenames = new Set(readdirSync(migrationsDirectory));
  return originalMigrationFiles.map((filename) => {
    assert.ok(filenames.has(filename), `missing original ProofPay AI migration ${filename}`);
    return {
      filename,
      sql: readFileSync(join(migrationsDirectory, filename), 'utf8')
    };
  });
}

function analyzeMigrations(migrations) {
  const tables = new Map();
  const foreignKeys = [];

  for (const migration of migrations) {
    collectCreateTables(migration.sql, migration.filename, tables, foreignKeys);
    collectAlteredCompositeForeignKeys(migration.sql, migration.filename, foreignKeys);
  }

  return { tables, foreignKeys, issues: missingReferencedUniqueKeys(foreignKeys, tables) };
}

test('composite foreign keys require a matching target primary or unique key', () => {
  const fixtureTables = new Map([['public.change_requests', [['id']]]]);
  const fixtureForeignKeys = [{
    file: 'fixture.sql',
    source: 'public.change_order_versions',
    columns: ['project_id', 'change_request_id'],
    target: 'public.change_requests',
    targetColumns: ['project_id', 'id']
  }];

  const issues = missingReferencedUniqueKeys(fixtureForeignKeys, fixtureTables);
  assert.equal(issues.length, 1);
  assert.match(issues[0].reason, /no PRIMARY KEY or UNIQUE constraint/);
});

test('all composite foreign keys in the seven original ordered migrations have matching target keys', () => {
  const migrations = readProjectMigrations();
  assert.equal(migrations.length, 7, 'expected all seven timestamped ProofPay AI migrations');

  const { issues, foreignKeys, tables } = analyzeMigrations(migrations);
  assert.equal(
    foreignKeys.length,
    8,
    `expected all eight composite foreign keys to be inspected; found: ${foreignKeys.map(({ file, source, columns, target, targetColumns }) => `${file} ${source}(${columns.join(',')}) -> ${target}(${targetColumns.join(',')})`).join('; ')}`
  );
  assert.deepEqual(issues, []);
  assert.ok(
    tables.get('public.change_requests')?.some((key) => key.join(',') === 'project_id,id'),
    'change_requests must declare UNIQUE (project_id, id) for the tenant-scoped change-order foreign key'
  );
});
