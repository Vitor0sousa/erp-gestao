// api/cloudinary-sign.js
import { createClient } from '@supabase/supabase-js';
import { v2 as cloudinary } from 'cloudinary';

export default async function handler(req, res) {
  // Só aceita POST — evita chamadas acidentais via GET/cache
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  // 1. Extrai o token da sessão enviado pelo Angular
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Não autenticado' });
  }

  // 2. Valida esse token contra o Supabase Auth
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada' });
  }

  // 3. Usuário confirmado — gera a assinatura do Cloudinary
  try {
    const timestamp = Math.round(Date.now() / 1000);

    const paramsParaAssinar = {
      timestamp,
      folder: 'produtos',
    };

    const signature = cloudinary.utils.api_sign_request(
      paramsParaAssinar,
      process.env.CLOUDINARY_API_SECRET
    );

    return res.status(200).json({
      signature,
      timestamp,
      apiKey: process.env.CLOUDINARY_API_KEY,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      folder: 'produtos',
    });
  } catch (err) {
    console.error('Erro ao gerar assinatura Cloudinary:', err);
    return res.status(500).json({ error: 'Erro interno ao gerar assinatura' });
  }
}