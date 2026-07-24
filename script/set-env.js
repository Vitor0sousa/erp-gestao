const fs = require('fs');
const path = require('path');

const envFileContent = `export const environment = {
  production: true,
  supabaseUrl: '${process.env.SUPABASE_URL}',
  supabaseKey: '${process.env.SUPABASE_ANON_KEY}',
  cloudinaryCloudName: '${process.env.CLOUDINARY_CLOUD_NAME}',
};
`;

const targetPath = path.join(__dirname, '../src/environments/environment.development.ts');
fs.writeFileSync(targetPath, envFileContent);
console.log('✅ environment.development.ts gerado com sucesso');