import fs from 'fs';
import path from 'path';

function searchDir(dir: string) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      searchDir(fullPath);
    } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.md')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('Placeholder Title 1') || content.includes('placeholder_canonical_atom_1') || content.includes('5268344b')) {
        console.log('Found in:', fullPath);
      }
    }
  }
}
searchDir('./src');
searchDir('../../reviewers');
console.log('Search complete.');
