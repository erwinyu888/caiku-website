import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface LoginPageProps {
  onLoginSuccess: () => void;
  onBack: () => void;
}

export default function LoginPage({ onLoginSuccess, onBack }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError('登入失敗：' + signInError.message);
      setLoading(false);
    } else {
      onLoginSuccess();
    }
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="bg-white border border-neutral-200 p-12">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-neutral-900 mb-2 uppercase tracking-wider">Admin Login</h1>
            <p className="text-neutral-600 text-sm">Enter your credentials to continue</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-neutral-600 mb-2 uppercase tracking-wider">
                Email
              </label>
              <input
                type="email"
                id="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm"
                placeholder="admin@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-medium text-neutral-600 mb-2 uppercase tracking-wider">
                Password
              </label>
              <input
                type="password"
                id="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm"
                placeholder="Enter password"
              />
            </div>

            {error && (
              <div className="flex items-center space-x-2 text-red-600 bg-red-50 border border-red-200 p-3">
                <AlertCircle size={18} />
                <span className="text-sm">{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-neutral-900 text-white py-3 font-medium hover:bg-neutral-800 transition-colors uppercase text-sm tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center space-x-2">
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Logging in...</span>
                </span>
              ) : (
                'Login'
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={onBack}
              className="text-neutral-600 hover:text-neutral-900 transition-colors text-sm"
            >
              Back to home
            </button>
          </div>
        </div>

        <div className="mt-6 text-center text-sm text-neutral-600">
          <p>Contact administrator for access</p>
        </div>
      </div>
    </div>
  );
}
