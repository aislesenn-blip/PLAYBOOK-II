const fs = require('fs');
let code = fs.readFileSync('js/ue_engine.js', 'utf8');

// Replace Promise.all mapping of chunk vectors with sequential loading for the sandbox environment
// to prevent OOM / process killing by the OS.
code = code.replace(
`const chunkVectors = await Promise.all(chunks.map(chunk => this._getVectorEmbedding(chunk)));`,
`let chunkVectors = [];\n        for (const chunk of chunks) {\n            chunkVectors.push(await this._getVectorEmbedding(chunk));\n        }`
);

fs.writeFileSync('js/ue_engine.js', code);
