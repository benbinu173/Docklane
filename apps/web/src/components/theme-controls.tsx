import { Sun } from '@phosphor-icons/react/dist/csr/Sun'
import { Moon } from '@phosphor-icons/react/dist/csr/Moon'
import { Desktop } from '@phosphor-icons/react/dist/csr/Desktop'
import { useTheme, type ColorTheme } from '@/lib/theme'

const themes = [
  { value: 'light', label: 'Light', detail: 'A bright, clear workspace.', icon: Sun },
  { value: 'dark', label: 'Dark', detail: 'A softer, darker canvas.', icon: Moon },
  { value: 'system', label: 'System', detail: 'Follow your device settings.', icon: Desktop },
] as const

export function ThemeToggle() {
  const { preference, setPreference } = useTheme()
  const next: ColorTheme =
    preference === 'system' ? 'dark' : preference === 'dark' ? 'light' : 'system'
  const Icon = themes.find((theme) => theme.value === preference)!.icon
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Change color theme, currently ${preference}`}
      title={`Use ${next === 'system' ? 'device' : next} theme`}
      onClick={() => setPreference(next)}
    >
      <Icon size={20} aria-hidden="true" />
    </button>
  )
}

export function ThemeSettings() {
  const { preference, setPreference } = useTheme()
  return (
    <section className="panel appearance-settings" aria-label="Appearance">
      <h2>Your preferred view.</h2>
      <p>Choose your colors. Docklane remembers them across pages.</p>
      <fieldset className="appearance-options">
        <legend className="sr-only">Color theme</legend>
        {themes.map(({ value, label, detail, icon: Icon }) => (
          <label key={value} data-selected={preference === value}>
            <input
              type="radio"
              name="color-theme"
              value={value}
              checked={preference === value}
              onChange={() => setPreference(value)}
            />
            <Icon size={24} weight="duotone" aria-hidden="true" />
            <strong>{label}</strong>
            <span>{detail}</span>
          </label>
        ))}
      </fieldset>
    </section>
  )
}
