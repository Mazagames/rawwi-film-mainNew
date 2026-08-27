import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const targetHash = '48ab84991d54727b2c0513c3d43181a408db0ace2a893d6aefe92c0ef62e4f88';

function checkHash(filePath: string) {
  try {
    const buffer = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    if (hash === targetHash) {
      console.log(`FOUND IT: ${filePath}`);
    }
  } catch (e) {}
}

function searchDir(dir: string) {
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory() && !fullPath.includes('node_modules') && !fullPath.includes('.git')) {
          searchDir(fullPath);
        } else if (fullPath.endsWith('.docx')) {
          checkHash(fullPath);
        }
      } catch (e) {}
    }
  } catch (e) {}
}

console.log('Searching workspace...');
searchDir('d:\\Waheed\\MypProjects\\raawi emergency\\rawwi-film-mainNew');
console.log('Done.');
