import { createClient } from 'npm:@supabase/supabase-js@2.110.8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return response({ error: 'Método no permitido.' }, 405);
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return response({ error: 'Sesión requerida.' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return response({ error: 'Función sin configuración de Supabase.' }, 500);
  }

  let body: { confirmation?: string };
  try {
    body = await request.json();
  } catch {
    return response({ error: 'Cuerpo JSON inválido.' }, 400);
  }
  if (body.confirmation !== 'ELIMINAR') {
    return response({ error: 'Escribe ELIMINAR para confirmar.' }, 400);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userResult, error: userError } = await userClient.auth.getUser();
  if (userError || !userResult.user) {
    return response({ error: 'La sesión ya no es válida.' }, 401);
  }
  const userId = userResult.user.id;

  const { data: prepared, error: prepareError } = await userClient.rpc(
    'prepare_my_account_deletion',
    { p_confirmation: body.confirmation }
  );
  if (prepareError) {
    return response({ error: prepareError.message }, 409);
  }

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(
    userId,
    true
  );
  await adminClient.rpc('complete_account_deletion_request', {
    p_user_id: userId,
    p_error: deleteError?.message ?? null,
  });
  if (deleteError) {
    return response(
      {
        error:
          'La cuenta quedó desactivada y anonimizada, pero el borrado de Auth debe reintentarse.',
      },
      500
    );
  }

  return response({ status: 'completed', request: prepared }, 200);
});

function response(payload: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
