import type { Session, User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  deleteCustomerRefreshToken,
  readCustomerRefreshToken,
  saveCustomerRefreshToken,
} from '@/auth/customer-session-storage';
import {
  type CustomerSignUpInput,
  normalizeCustomerEmail,
  normalizeCustomerPhone,
  validateCustomerSignUp,
} from '@/auth/customer-auth-validation';
import {
  getCustomerAuthErrorMessage,
  isCustomerEmailConfirmationRequired,
} from '@/auth/customer-auth-error';
import {
  getCustomerSupabaseClient,
  getSupabasePublicConfig,
} from '@/auth/supabase-client';
import { DEFAULT_STORE_ID } from '@/database/seed';

type CustomerAuthState =
  | 'loading'
  | 'unconfigured'
  | 'anonymous'
  | 'authenticating'
  | 'authenticated'
  | 'verification_required'
  | 'offline'
  | 'error';

export type CustomerAccount = {
  id: string;
  authUserId: string;
  name: string;
  phone: string;
  email: string | null;
};

type CustomerAuthContextValue = {
  state: CustomerAuthState;
  account: CustomerAccount | null;
  verificationEmail: string | null;
  message: string | null;
  isConfigured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: CustomerSignUpInput) => Promise<void>;
  signOut: () => Promise<void>;
  continueToSignIn: () => void;
  updatePassword: (password: string) => Promise<void>;
  sendPasswordReset: (email: string, redirectTo: string) => Promise<void>;
  getAccessToken: () => Promise<string | null>;
};

const CustomerAuthContext = createContext<CustomerAuthContextValue | null>(null);

async function claimCustomerAccount(
  user: User,
  fallback?: { name: string; phone: string }
): Promise<CustomerAccount> {
  const client = getCustomerSupabaseClient();
  if (!client) throw new Error('Supabase no está configurado.');
  const metadata = user.user_metadata as Record<string, unknown>;
  const name =
    fallback?.name.trim() ||
    (typeof metadata.full_name === 'string' ? metadata.full_name.trim() : '');
  const phone =
    fallback?.phone ||
    (typeof metadata.phone === 'string'
      ? normalizeCustomerPhone(metadata.phone)
      : '');
  const { data, error } = await client
    .rpc('claim_customer_account', {
      p_store_id: DEFAULT_STORE_ID,
      p_name: name || null,
      p_phone: phone || null,
      p_email: user.email ?? null,
    })
    .single();
  if (error) throw error;
  const row = data as {
    customer_id?: unknown;
    auth_user_id?: unknown;
    customer_name?: unknown;
    customer_phone?: unknown;
    customer_email?: unknown;
  } | null;
  if (
    !row ||
    typeof row.customer_id !== 'string' ||
    row.auth_user_id !== user.id ||
    typeof row.customer_name !== 'string' ||
    typeof row.customer_phone !== 'string'
  ) {
    throw new Error('Supabase no devolvió un perfil de cliente válido.');
  }
  return {
    id: row.customer_id,
    authUserId: user.id,
    name: row.customer_name,
    phone: row.customer_phone,
    email: typeof row.customer_email === 'string' ? row.customer_email : null,
  };
}

export function CustomerAuthProvider({ children }: PropsWithChildren) {
  const client = getCustomerSupabaseClient();
  const [state, setState] = useState<CustomerAuthState>('loading');
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const sessionRef = useRef<Session | null>(null);

  const clearSession = useCallback(() => {
    sessionRef.current = null;
    setAccount(null);
  }, []);

  const activateSession = useCallback(async (session: Session) => {
    const customer = await claimCustomerAccount(session.user);
    await saveCustomerRefreshToken(session.refresh_token);
    sessionRef.current = session;
    setAccount(customer);
    setVerificationEmail(null);
    setMessage(null);
    setState('authenticated');
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!client) {
        if (active) setState('unconfigured');
        return;
      }
      const refreshToken = await readCustomerRefreshToken();
      if (!refreshToken) {
        if (active) setState('anonymous');
        return;
      }
      try {
        const { data, error } = await client.auth.refreshSession({
          refresh_token: refreshToken,
        });
        if (error) throw error;
        if (!data.session) throw new Error('La sesión guardada ya no es válida.');
        if (!active) return;
        await activateSession(data.session);
      } catch (error) {
        await deleteCustomerRefreshToken();
        if (!active) return;
        clearSession();
        setState('offline');
        setMessage(getCustomerAuthErrorMessage(error));
      }
    })();
    return () => {
      active = false;
    };
  }, [activateSession, clearSession, client]);

  useEffect(() => {
    if (!client) return;
    let active = true;
    const consumeAuthUrl = async (url: string | null) => {
      if (!url) return;
      const queryStart = url.indexOf('?');
      const hashStart = url.indexOf('#');
      const raw =
        hashStart >= 0
          ? url.slice(hashStart + 1)
          : queryStart >= 0
            ? url.slice(queryStart + 1)
            : '';
      const parameters = new URLSearchParams(raw);
      try {
        const code = parameters.get('code');
        const accessToken = parameters.get('access_token');
        const refreshToken = parameters.get('refresh_token');
        let session: Session | null = null;
        if (code) {
          const { data, error } = await client.auth.exchangeCodeForSession(code);
          if (error) throw error;
          session = data.session;
        } else if (accessToken && refreshToken) {
          const { data, error } = await client.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
          session = data.session;
        }
        if (session && active) await activateSession(session);
      } catch (error) {
        if (!active) return;
        setState('error');
        setMessage(getCustomerAuthErrorMessage(error));
      }
    };
    void Linking.getInitialURL().then(consumeAuthUrl);
    const subscription = Linking.addEventListener('url', ({ url }) => {
      void consumeAuthUrl(url);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [activateSession, client]);

  const signIn = useCallback(
    async (emailValue: string, password: string) => {
      if (!client) throw new Error('Configura Supabase antes de iniciar sesión.');
      const email = normalizeCustomerEmail(emailValue);
      if (!password) throw new Error('Ingresa tu contraseña.');
      setState('authenticating');
      setMessage(null);
      try {
        const { data, error } = await client.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        if (!data.session || !data.user) {
          throw new Error('Supabase no devolvió una sesión válida.');
        }
        await activateSession(data.session);
      } catch (error) {
        clearSession();
        if (isCustomerEmailConfirmationRequired(error)) {
          setVerificationEmail(email);
          setState('verification_required');
          return;
        }
        const authMessage = getCustomerAuthErrorMessage(error);
        setState('error');
        setMessage(authMessage);
        throw new Error(authMessage);
      }
    },
    [activateSession, clearSession, client]
  );

  const signUp = useCallback(
    async (input: CustomerSignUpInput) => {
      if (!client) throw new Error('Configura Supabase antes de registrarte.');
      const { name, phone, email, password } = validateCustomerSignUp(input);
      setState('authenticating');
      setMessage(null);
      try {
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: name,
              phone,
              account_type: 'customer',
              consent_version: '2026-07-27',
            },
          },
        });
        if (error) throw error;
        if (!data.user) throw new Error('Supabase no creó la cuenta.');
        if (!data.session) {
          clearSession();
          setVerificationEmail(email);
          setState('verification_required');
          return;
        }
        const customer = await claimCustomerAccount(data.user, { name, phone });
        await saveCustomerRefreshToken(data.session.refresh_token);
        sessionRef.current = data.session;
        setAccount(customer);
        setVerificationEmail(null);
        setState('authenticated');
      } catch (error) {
        clearSession();
        const authMessage = getCustomerAuthErrorMessage(error);
        setState('error');
        setMessage(authMessage);
        throw new Error(authMessage);
      }
    },
    [clearSession, client]
  );

  const signOut = useCallback(async () => {
    const session = sessionRef.current;
    clearSession();
    setVerificationEmail(null);
    setMessage(null);
    setState(client ? 'anonymous' : 'unconfigured');
    await deleteCustomerRefreshToken();
    if (client && session) {
      await client.auth.signOut({ scope: 'local' });
    }
  }, [clearSession, client]);

  const continueToSignIn = useCallback(() => {
    clearSession();
    setVerificationEmail(null);
    setMessage(null);
    setState(client ? 'anonymous' : 'unconfigured');
  }, [clearSession, client]);

  const updatePassword = useCallback(
    async (password: string) => {
      if (!client || !account) throw new Error('Inicia sesión para cambiar tu contraseña.');
      if (password.length < 8) {
        throw new Error('La contraseña debe tener al menos 8 caracteres.');
      }
      const { error } = await client.auth.updateUser({ password });
      if (error) throw new Error(getCustomerAuthErrorMessage(error));
    },
    [account, client]
  );

  const sendPasswordReset = useCallback(
    async (emailValue: string, redirectTo: string) => {
      if (!client) throw new Error('Supabase no está configurado.');
      const email = normalizeCustomerEmail(emailValue);
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo,
      });
      if (error) throw new Error(getCustomerAuthErrorMessage(error));
    },
    [client]
  );

  const getAccessToken = useCallback(async () => {
    if (!client || !account) return null;
    const session = sessionRef.current;
    if (session && (session.expires_at ?? 0) * 1000 > Date.now() + 60_000) {
      return session.access_token;
    }
    const refreshToken =
      session?.refresh_token ?? (await readCustomerRefreshToken());
    if (!refreshToken) return null;
    try {
      const { data, error } = await client.auth.refreshSession({
        refresh_token: refreshToken,
      });
      if (error) throw error;
      if (!data.session || data.user?.id !== account.authUserId) return null;
      await saveCustomerRefreshToken(data.session.refresh_token);
      sessionRef.current = data.session;
      return data.session.access_token;
    } catch (error) {
      clearSession();
      setState('offline');
      setMessage(getCustomerAuthErrorMessage(error));
      return null;
    }
  }, [account, clearSession, client]);

  const value = useMemo<CustomerAuthContextValue>(
    () => ({
      state,
      account,
      verificationEmail,
      message,
      isConfigured: getSupabasePublicConfig().isConfigured,
      signIn,
      signUp,
      signOut,
      continueToSignIn,
      updatePassword,
      sendPasswordReset,
      getAccessToken,
    }),
    [
      account,
      continueToSignIn,
      getAccessToken,
      message,
      signIn,
      signOut,
      signUp,
      sendPasswordReset,
      state,
      updatePassword,
      verificationEmail,
    ]
  );

  return (
    <CustomerAuthContext.Provider value={value}>
      {children}
    </CustomerAuthContext.Provider>
  );
}

export function useCustomerAuth() {
  const value = useContext(CustomerAuthContext);
  if (!value) {
    throw new Error('useCustomerAuth debe usarse dentro de CustomerAuthProvider.');
  }
  return value;
}
