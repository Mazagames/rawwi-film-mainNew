const Module = require('module');
const path = require('path');

const workspaceRoot = path.resolve(__dirname);
const webSrcRoot = path.join(workspaceRoot, 'apps', 'web', 'src');

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    const relativePath = request.slice(2);
    const resolved = path.resolve(webSrcRoot, relativePath);
    return originalResolveFilename.call(this, resolved, parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
