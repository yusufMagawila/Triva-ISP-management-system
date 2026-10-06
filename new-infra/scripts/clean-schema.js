const fs = require('fs');
const data = fs.readFileSync('triva_db_schema.sql', 'utf8');
const lines = data.split('\n');
const out = lines.filter(line => {
  if (line.length > 0 && line.charCodeAt(0) === 92) {
    const rest = line.slice(1);
    if (rest.startsWith('restrict') || rest.startsWith('unrestrict')) {
      return false;
    }
  }
  if (line.startsWith('-- Dumped from database') || line.startsWith('-- Dumped by pg_dump')) {
    return false;
  }
  return true;
});
fs.writeFileSync('new-infra/backend/prisma/migrations/20241006000000_baseline/migration.sql', out.join('\n'));
console.log('Wrote', out.length, 'lines');
