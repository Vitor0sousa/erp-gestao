const fs = require('fs');
const path = require('path');

const envFileContent = `export const environment = {
  production: true,
  supabaseUrl: '${process.env.SUPABASE_URL}',
  supabaseKey: '${process.env.SUPABASE_ANON_KEY}',
  cloudinaryCloudName: '${process.env.CLOUDINARY_CLOUD_NAME}',
};
`;

const targetDir = path.join(__dirname, '../src/environments');
const targetPath = path.join(targetDir, 'environment.development.ts');

// Garante que a pasta existe antes de escrever
fs.mkdirSync(targetDir, { recursive: true });

fs.writeFileSync(targetPath, envFileContent);
console.log('✅ environment.development.ts gerado com sucesso');