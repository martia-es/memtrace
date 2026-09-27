<script setup lang="ts">
// Auth.js no arranca el proveedor por GET con ?provider=: su página /api/auth/signin
// solo lista opciones. Para saltar directo hay que POSTear el csrfToken a
// /api/auth/signin/{provider} (lo mismo que hace su botón por dentro), así el usuario
// no ve una pantalla intermedia.
async function signIn(provider: "google" | "microsoft") {
  const res = await fetch("/api/auth/csrf");
  const { csrfToken } = await res.json();

  const form = document.createElement("form");
  form.method = "POST";
  form.action = `/api/auth/signin/${provider}`;
  form.style.display = "none";

  const fields = { csrfToken, callbackUrl: window.location.origin };
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
}
</script>

<template>
  <div class="login-container">
    <div class="showcase-panel">
      <div class="panel-glow panel-glow-1" aria-hidden="true"></div>
      <div class="panel-glow panel-glow-2" aria-hidden="true"></div>
      <div class="panel-grid" aria-hidden="true"></div>

      <div class="showcase">
        <div class="showcase-brand">
          <svg width="26" height="26" viewBox="0 0 22 22" aria-hidden="true">
            <rect x="1" y="3" width="12" height="4" rx="2" fill="#8FE86B" />
            <rect x="6" y="9" width="15" height="4" rx="2" fill="#9C87FF" />
            <rect x="3" y="15" width="9" height="4" rx="2" fill="#FFA25E" />
          </svg>
          <span>memtrace</span>
        </div>

        <h1 class="showcase-title">Ve exactamente qué hace tu agente, paso a paso.</h1>
        <p class="showcase-sub">
          Trazas, spans y coste de cada conversación de tus agentes LLM, sin instrumentar nada a mano.
        </p>

        <div class="mockup">
          <div class="mockup-row">
            <div class="mockup-kpi">
              <div class="mockup-kpi-label">TRACES</div>
              <div class="mockup-kpi-value">1,204</div>
            </div>
            <div class="mockup-kpi">
              <div class="mockup-kpi-label">LATENCY P95</div>
              <div class="mockup-kpi-value">840ms</div>
            </div>
            <div class="mockup-kpi">
              <div class="mockup-kpi-label">ERRORS</div>
              <div class="mockup-kpi-value ok">0.4%</div>
            </div>
          </div>
          <div class="mockup-trace">
            <span class="mockup-pill ok">ok</span>
            <span class="mockup-trace-name">agent · search_flights → book_ticket</span>
            <span class="mockup-trace-meta">312ms</span>
          </div>
          <div class="mockup-trace">
            <span class="mockup-pill warn">retry</span>
            <span class="mockup-trace-name">agent · call_llm(gpt-4)</span>
            <span class="mockup-trace-meta">1.1s</span>
          </div>
          <div class="mockup-trace">
            <span class="mockup-pill ok">ok</span>
            <span class="mockup-trace-name">tool · fetch_weather</span>
            <span class="mockup-trace-meta">88ms</span>
          </div>
        </div>

        <ul class="showcase-features">
          <li>Sesiones y árboles de spans, no solo logs sueltos</li>
          <li>Latencia, tokens y coste por modelo y por herramienta</li>
          <li>LangChain, LangGraph y PydanticAI en Python o TypeScript</li>
        </ul>
      </div>
    </div>

    <div class="login-panel">
      <div class="login-card">
        <div class="brand mobile-only">
          <svg width="30" height="30" viewBox="0 0 22 22" aria-hidden="true">
            <rect x="1" y="3" width="12" height="4" rx="2" fill="#6FCF4A" />
            <rect x="6" y="9" width="15" height="4" rx="2" fill="#7A5AF8" />
            <rect x="3" y="15" width="9" height="4" rx="2" fill="#FF8A3D" />
          </svg>
          <span>memtrace</span>
        </div>
        <h2 class="welcome">Bienvenido de nuevo</h2>
        <p class="hint">Inicia sesión para ver tus experimentos.</p>
        <button class="signin-btn primary" type="button" @click="signIn('google')">
          <span class="provider-icon">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.85 2.09-1.81 2.73v2.27h2.92c1.7-1.57 2.69-3.88 2.69-6.64z"/>
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.17l-2.92-2.27c-.81.54-1.84.87-3.04.87-2.34 0-4.32-1.58-5.03-3.7H.9v2.34C2.38 15.98 5.44 18 9 18z"/>
              <path fill="#FBBC05" d="M3.97 10.73a5.4 5.4 0 0 1 0-3.46V4.93H.9a8.99 8.99 0 0 0 0 8.14l3.07-2.34z"/>
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0 5.44 0 2.38 2.02.9 4.93l3.07 2.34C4.68 5.16 6.66 3.58 9 3.58z"/>
            </svg>
          </span>
          Iniciar sesión con Google
        </button>
        <button class="signin-btn" type="button" @click="signIn('microsoft')">
          <span class="provider-icon">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <rect x="1" y="1" width="7.5" height="7.5" fill="#F35325"/>
              <rect x="9.5" y="1" width="7.5" height="7.5" fill="#81BC06"/>
              <rect x="1" y="9.5" width="7.5" height="7.5" fill="#05A6F0"/>
              <rect x="9.5" y="9.5" width="7.5" height="7.5" fill="#FFBA08"/>
            </svg>
          </span>
          Iniciar sesión con Microsoft
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-container {
  display: flex;
  height: 100vh;
  background: var(--mt-bg);
}

/* Panel izquierdo: gradiente oscuro fijo de marca, independiente del tema claro/oscuro,
   para dar el mismo impacto de "hero" en ambos casos. */
.showcase-panel {
  position: relative;
  flex: 1.1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px;
  overflow: hidden;
  background: linear-gradient(155deg, #0d1f14 0%, #143b25 42%, #1f5c38 78%, #2a7a49 100%);
}
.panel-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  pointer-events: none;
}
.panel-glow-1 {
  width: 520px;
  height: 520px;
  top: -160px;
  left: -120px;
  background: radial-gradient(circle, rgba(143, 232, 107, 0.45) 0%, transparent 70%);
}
.panel-glow-2 {
  width: 480px;
  height: 480px;
  bottom: -200px;
  right: -140px;
  background: radial-gradient(circle, rgba(156, 135, 255, 0.35) 0%, transparent 70%);
}
.panel-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.06) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: radial-gradient(ellipse 70% 65% at 50% 40%, black 20%, transparent 78%);
}

.showcase {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 480px;
}
.showcase-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #ffffff;
}
.showcase-title {
  font-size: 44px;
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.12;
  margin: 4px 0 0;
  color: #ffffff;
}
.showcase-sub {
  font-size: 15px;
  color: rgba(255, 255, 255, 0.72);
  margin: 0;
  line-height: 1.55;
  max-width: 420px;
}
.showcase-features {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 13.5px;
  color: rgba(255, 255, 255, 0.82);
}
.showcase-features li {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.showcase-features li::before {
  content: "";
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #8fe86b;
  transform: translateY(-2px);
}

.mockup {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.14);
  backdrop-filter: blur(16px);
  box-shadow: 0 24px 60px -16px rgba(0, 0, 0, 0.45);
  transform: perspective(1200px) rotateX(1.5deg);
}
.mockup-row {
  display: flex;
  gap: 10px;
}
.mockup-kpi {
  flex: 1;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.07);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mockup-kpi-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: rgba(255, 255, 255, 0.55);
}
.mockup-kpi-value {
  font-size: 16px;
  font-weight: 700;
  color: #ffffff;
}
.mockup-kpi-value.ok {
  color: #b9f28c;
}
.mockup-trace {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
  font-size: 12px;
}
.mockup-pill {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}
.mockup-pill.ok {
  background: rgba(185, 242, 140, 0.18);
  color: #b9f28c;
}
.mockup-pill.warn {
  background: rgba(255, 207, 128, 0.18);
  color: #ffcf80;
}
.mockup-trace-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mt-mono);
  color: #ffffff;
}
.mockup-trace-meta {
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.55);
  font-family: var(--mt-mono);
  font-size: 11px;
}

.login-panel {
  flex: 1;
  min-width: 420px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ffffff;
}
:global(body.body--dark) .login-panel {
  background: var(--mt-card);
}
.login-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 14px;
  width: 340px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: var(--mt-ink);
  align-self: center;
}
.brand.mobile-only {
  display: none;
}
.welcome {
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--mt-ink);
  margin: 0;
}
.hint {
  color: var(--mt-muted);
  font-size: 14px;
  margin: 0 0 10px;
}
.signin-btn {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  height: 52px;
  padding: 0 20px;
  border: 1.5px solid var(--mt-line);
  border-radius: 14px;
  background: #ffffff;
  color: var(--mt-ink);
  font: inherit;
  font-size: 14.5px;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
  width: 100%;
}
.provider-icon {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: var(--mt-soft);
}
.signin-btn:hover {
  border-color: var(--mt-faint);
  transform: translateY(-1px);
  box-shadow: 0 8px 20px rgba(20, 60, 35, 0.1);
}
.signin-btn.primary {
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
  border-color: var(--mt-accent);
}
.signin-btn.primary .provider-icon {
  background: #ffffff;
}
.signin-btn.primary:hover {
  border-color: var(--mt-accent);
  box-shadow: 0 8px 20px -4px color-mix(in srgb, var(--mt-accent) 55%, transparent);
}

@media (max-width: 900px) {
  .showcase-panel {
    display: none;
  }
  .login-panel {
    min-width: 0;
    width: 100%;
    padding: 0 24px;
  }
  .brand.mobile-only {
    display: flex;
    margin-bottom: 4px;
  }
}
</style>
