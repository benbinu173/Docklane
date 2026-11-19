import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowRight } from '@phosphor-icons/react/dist/csr/ArrowRight'
import { ArrowLeft } from '@phosphor-icons/react/dist/csr/ArrowLeft'
import { Eye } from '@phosphor-icons/react/dist/csr/Eye'
import { EyeSlash } from '@phosphor-icons/react/dist/csr/EyeSlash'
import { CheckCircle } from '@phosphor-icons/react/dist/csr/CheckCircle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { signInSchema, signUpSchema } from '@docklane/contracts'
import { useIdentity, useProfile } from '@/lib/identity-context'
import { authClient } from '@/lib/auth-client'

function homeFor(role?: string) {
  return role === 'CUSTOMER' ? '/account/orders' : '/workspace'
}
function safeNext(value: string | null, fallback: string) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))
    return fallback
  const url = new URL(value, window.location.origin)
  return url.origin === window.location.origin && /^\/(workspace|account)(\/|$)/.test(url.pathname)
    ? `${url.pathname}${url.search}`
    : fallback
}
export function Authentication() {
  const reduced = useReducedMotion()
  const { view = 'sign-in' } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { refresh, signOut, configured, session } = useIdentity()
  const profile = useProfile()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [visible, setVisible] = useState(false)
  const signup = view === 'sign-up'
  const forgot = view === 'forgot-password'
  const reset = view === 'reset-password'
  const token = params.get('token')
  const openingAccount = !forgot && !reset && !!session && profile.isPending
  if (!['sign-in', 'sign-up', 'forgot-password', 'reset-password'].includes(view))
    return <Navigate to="/auth/sign-in" replace />
  if (!forgot && !reset && session && profile.data && !profile.isError)
    return <Navigate to={safeNext(params.get('next'), homeFor(profile.data.data.role))} replace />
  const title = signup
    ? 'A place for your next order.'
    : forgot
      ? 'Let’s get you back in.'
      : reset
        ? 'A fresh start, securely.'
        : 'Good to have you back.'
  const subtitle = signup
    ? 'Create your customer account and keep every order in view.'
    : forgot
      ? 'Enter your account email. We’ll send a password reset link.'
      : reset
        ? 'Choose a new password for your Docklane account.'
        : 'Sign in to see your orders and workspace.'
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!authClient) {
      setError('Sign-in is being configured. You can still explore the sample workspace.')
      return
    }
    const form = new FormData(event.currentTarget)
    const passwordField = event.currentTarget.elements.namedItem('password')
    const email = String(form.get('email') ?? '').trim()
    const password = String(form.get('password') ?? '')
    setError('')
    setPending(true)
    try {
      if (forgot) {
        const result = await authClient.requestPasswordReset({
          email,
          redirectTo: `${window.location.origin}/auth/reset-password`,
        })
        if (result.error)
          throw new Error(result.error.message ?? 'Unable to send the reset link. Try again.')
        setSuccess(true)
      } else if (reset) {
        if (!token) throw new Error('This reset link is missing. Request a new one.')
        if (password.length < 12) throw new Error('Use at least 12 characters.')
        if (password !== String(form.get('confirm-password')))
          throw new Error('The passwords do not match.')
        const result = await authClient.resetPassword({ token, newPassword: password })
        if (result.error)
          throw new Error(
            result.error.message ?? 'This reset link is invalid or expired. Request a new one.',
          )
        await signOut()
        setSuccess(true)
      } else {
        const payload = signup
          ? { name: String(form.get('name') ?? ''), email, password }
          : { email, password }
        const parsed = signup ? signUpSchema.safeParse(payload) : signInSchema.safeParse(payload)
        if (!parsed.success) throw new Error(parsed.error.issues[0].message)
        const result = signup
          ? await authClient.signUp.email({
              name: String(form.get('name')).trim(),
              email,
              password,
            })
          : await authClient.signIn.email({ email, password })
        if (result.error)
          throw new Error(result.error.message ?? 'Check your email and password and try again.')
        if (!(await refresh()))
          throw new Error('Your session could not be restored. Please try signing in again.')
        if (passwordField instanceof HTMLInputElement) passwordField.value = ''
      }
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : 'Something went wrong. Your entries have been kept; try again.',
      )
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="auth-layout">
      <aside className="auth-story" aria-label="About Docklane">
        <Link to="/" className="auth-wordmark">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          docklane<span>.</span>
        </Link>
        <div className="auth-story-copy">
          <span className="auth-eyebrow">EVERY ORDER, MOVING FORWARD</span>
          <h2>
            A clear path.
            <br />A thoughtful workspace.
          </h2>
          <p>
            Stock, orders, and the people behind them.
            <br />
            Bring every detail into view.
          </p>
        </div>
        <div className="auth-lanes" aria-hidden="true">
          <div className="lane-station">
            01 <span>Your stock</span>
          </div>
          <div className="lane-track">
            <span />
            <span />
            <span />
          </div>
          <div className="lane-station">
            02 <span>Your orders</span>
          </div>
          <div className="lane-track">
            <span />
            <span />
            <span />
          </div>
          <div className="lane-station accent">
            03 <span>Your next move</span>
          </div>
        </div>
        <div className="auth-story-footer">
          <span>NORTHSTAR SUPPLY</span>
          <span>Made for the way you move.</span>
        </div>
      </aside>
      <main className="auth-main">
        <Link to="/" className="auth-back">
          <ArrowLeft size={17} />
          Explore the sample workspace
        </Link>
        <motion.div
          className="auth-form-content"
          key={view}
          initial={{ opacity: reduced ? 1 : 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reduced ? 0 : 0.18 }}
        >
          <span className="auth-mini-logo">
            <img src="/favicon.svg" alt="Docklane" width={38} height={38} />
          </span>
          <span className="auth-eyebrow">
            {signup ? 'YOUR DOCKLANE ACCOUNT' : 'WELCOME TO DOCKLANE'}
          </span>
          <h1>{title}</h1>
          <p className="auth-subtitle">{subtitle}</p>
          {!configured && (
            <div className="auth-message" role="status">
              Sign-in is being set up. The sample workspace is available now.
            </div>
          )}
          {success ? (
            <div className="auth-success" role="status">
              <CheckCircle size={38} weight="duotone" />
              <h2>{reset ? 'Your password is updated.' : 'Check your inbox.'}</h2>
              <p>
                {reset
                  ? 'You can now sign in with your new password.'
                  : 'If an account exists for that email, a reset link has been sent. Check your spam folder too.'}
              </p>
              <Button className="btn-primary full-width" onClick={() => navigate('/auth/sign-in')}>
                Return to sign in
                <ArrowRight size={17} />
              </Button>
            </div>
          ) : reset && !token ? (
            <div className="auth-message">
              <p>This reset link is missing or incomplete. Request a fresh link to continue.</p>
              <Link to="/auth/forgot-password" className="text-link">
                Request a reset link
                <ArrowRight size={16} />
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="auth-form">
              <fieldset disabled={pending || !configured || openingAccount}>
                {signup && (
                  <div className="auth-field">
                    <label htmlFor="auth-name">Full name</label>
                    <Input
                      id="auth-name"
                      name="name"
                      autoComplete="name"
                      placeholder="Your full name"
                      required
                      minLength={2}
                      maxLength={80}
                    />
                  </div>
                )}
                {!reset && (
                  <div className="auth-field">
                    <label htmlFor="auth-email">Email address</label>
                    <Input
                      id="auth-email"
                      name="email"
                      type="email"
                      autoComplete="username"
                      placeholder="you@example.com"
                      required
                      maxLength={254}
                    />
                  </div>
                )}
                {!forgot && (
                  <div className="auth-field">
                    <div className="auth-field-label">
                      <label htmlFor="auth-password">{reset ? 'New password' : 'Password'}</label>
                      {!signup && !reset && (
                        <Link to="/auth/forgot-password">Forgot password?</Link>
                      )}
                    </div>
                    <div className="auth-password">
                      <Input
                        id="auth-password"
                        name="password"
                        type={visible ? 'text' : 'password'}
                        autoComplete={signup || reset ? 'new-password' : 'current-password'}
                        placeholder={
                          signup || reset ? 'At least 12 characters' : 'Enter your password'
                        }
                        required
                        minLength={signup || reset ? 12 : 1}
                        maxLength={128}
                      />
                      <button
                        type="button"
                        onClick={() => setVisible(!visible)}
                        aria-label={visible ? 'Hide password' : 'Show password'}
                      >
                        {visible ? <EyeSlash size={20} /> : <Eye size={20} />}
                      </button>
                    </div>
                    {(signup || reset) && (
                      <small>Use a long, unique password with at least 12 characters.</small>
                    )}
                  </div>
                )}
                {reset && (
                  <div className="auth-field">
                    <label htmlFor="auth-confirm">Confirm new password</label>
                    <Input
                      id="auth-confirm"
                      name="confirm-password"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={12}
                      maxLength={128}
                    />
                  </div>
                )}
                {error && (
                  <p className="auth-error" role="alert">
                    {error}
                  </p>
                )}
                {openingAccount && (
                  <p className="auth-subtitle" role="status">
                    Opening your saved account…
                  </p>
                )}
                {!forgot && !reset && session && profile.isError && (
                  <div className="auth-message">
                    <p className="auth-error" role="alert">
                      {profile.error.message}
                    </p>
                    <Button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        void profile.refetch()
                      }}
                    >
                      Retry opening account
                    </Button>
                  </div>
                )}
                <Button
                  className="btn-primary full-width"
                  type="submit"
                  disabled={pending || !configured || openingAccount}
                >
                  {pending
                    ? 'One moment…'
                    : signup
                      ? 'Create customer account'
                      : forgot
                        ? 'Send reset link'
                        : reset
                          ? 'Update password'
                          : 'Sign in'}
                  {!pending && <ArrowRight size={18} />}
                </Button>
              </fieldset>
            </form>
          )}
          {!forgot && !reset && (
            <p className="auth-switch">
              {signup ? 'Already have an account?' : 'New to Docklane?'}{' '}
              <Link to={signup ? '/auth/sign-in' : '/auth/sign-up'}>
                {signup ? 'Sign in' : 'Create a customer account'}
              </Link>
            </p>
          )}
          {(forgot || reset) && (
            <Link to="/auth/sign-in" className="auth-back bottom">
              <ArrowLeft size={16} />
              Back to sign in
            </Link>
          )}
          <div className="auth-form-note">
            <span />
            Your account opens the right view for your role.
            <br />
            Staff access is granted by a workspace admin.
          </div>
        </motion.div>
        <footer className="auth-page-footer">
          <span>Docklane</span>
          <span>Every order, moving forward.</span>
        </footer>
      </main>
    </div>
  )
}
