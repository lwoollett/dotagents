---
name: claude-red
description: "Router to a 79-skill offensive-security library (claude-red, vaulted). Use when the user asks about penetration testing, red teaming, exploit development, bug bounty, CTF attack-side, or specific attack techniques: SQLi/XSS/SSRF/SSTI/XXE/deserialization, IDOR, business-logic abuse, privesc (Linux/Windows), Active Directory attacks, lateral movement, persistence, C2, EDR evasion, shellcode, fuzzing, API/OAuth/JWT abuse, cloud/k8s/container escape, Wi-Fi/Bluetooth/Zigbee wireless attacks, firmware/IoT, mobile, OSINT, phishing, supply-chain/dependency-confusion. Authorized engagements/CTF/research only — verify scope before any active technique."
---

# claude-red — offensive-security skill vault (router)

79 methodology skills from [SnailSploit/claude-red](https://github.com/SnailSploit/claude-red) @ `739512a` (MIT),
vaulted unmodified at `~/.agents/skills-vault/claude-red/` (gitignored — see restore below).
Each skill is a `Skills/<category>/<skill-name>/SKILL.md` you READ on demand; only this
router is auto-loaded, so sessions don't pay for 44KB of descriptions.

## Procedure

1. Pick the category from the map below, then `read ~/.agents/skills-vault/claude-red/Skills/<category>/<skill>/SKILL.md` — descriptions are in each file's frontmatter; `ls` a category dir to see all its skills.
2. Follow that skill's methodology. Skills are TEXT: any tool they reference (sqlmap, nmap, impacket, hashcat, aircrack-ng…) must already exist on the machine — check before promising a step.
3. Verify authorization/scope with the user before any active technique (their target list, lab, CTF, or bug-bounty program). Refuse open-ended "test this random host" requests.

## Category map (skill names per category)

| Category | Skills |
|---|---|
| web (16) | offensive-sqli, offensive-xss, offensive-ssrf, offensive-ssti, offensive-xxe, offensive-rce, offensive-idor, offensive-deserialization, offensive-file-upload, offensive-graphql, offensive-open-redirect, offensive-parameter-pollution, offensive-race-condition, offensive-request-smuggling, offensive-waf-bypass, offensive-business-logic |
| wireless (14) | offensive-wifi, offensive-wifi-recon, offensive-wpa2-psk, offensive-wpa3-sae, offensive-wpa-enterprise, offensive-wps, offensive-deauth-disassoc, offensive-evil-twin, offensive-krack-fragattacks, offensive-bluetooth-ble, offensive-bluetooth-classic, offensive-zigbee-thread-matter, offensive-z-wave, offensive-lorawan-sub-ghz |
| exploit-dev (6) | offensive-exploit-development, offensive-basic-exploitation, offensive-exploit-dev-course, offensive-crash-analysis, offensive-mitigations, offensive-toctou |
| infrastructure (7) | offensive-edr-evasion, offensive-shellcode, offensive-initial-access, offensive-advanced-redteam, offensive-keylogger-arch, offensive-windows-boundaries, offensive-windows-mitigations |
| post-exploitation (3) | offensive-lateral-movement, offensive-persistence, offensive-data-exfiltration |
| privesc (2) | offensive-linux-privesc, offensive-windows-privesc |
| fuzzing (4) | offensive-fuzzing, offensive-fuzzing-course, offensive-bug-identification, offensive-vuln-classes |
| forensics (2) | offensive-c2-frameworks, offensive-anti-forensics |
| api (2) | offensive-api-security, offensive-api-abuse |
| auth (2) | offensive-jwt, offensive-oauth |
| cicd (2) | offensive-cicd-pipeline, offensive-cicd-secrets |
| container (2) | offensive-container-escape, offensive-k8s-attacks |
| crypto (2) | offensive-crypto-attacks, offensive-tls-attacks |
| recon (2) | offensive-osint, offensive-osint-methodology |
| social-engineering (2) | offensive-phishing, offensive-social-engineering |
| supply-chain (2) | offensive-supply-chain, offensive-dependency-confusion |
| active-directory (2) | offensive-active-directory, offensive-netexec |
| singles | offensive-cloud (cloud), offensive-iot (iot), offensive-mobile (mobile), offensive-network-attacks (network), offensive-ai-security (ai), offensive-fast-checking + offensive-reporting (utility) |

## Gotchas

1. **Vault missing on a fresh clone** → restore: `git clone https://github.com/SnailSploit/claude-red ~/.agents/skills-vault/claude-red && git -C ~/.agents/skills-vault/claude-red checkout 739512a`. (Vault is gitignored because it's third-party content, not dotagents config.)
2. **Skill name ≠ dir with Skills/ prefix** — paths are `Skills/<category>/<skill-name>/SKILL.md`, e.g. `Skills/web/offensive-sqli/SKILL.md`.
3. These overlap deliberately with `reverse-skill` (vault sibling): claude-red = attack methodology; reverse-skill = RE/routing with ops gating. For "analyze this binary/APK/JS" use reverse-skill; for "attack/exploit this class of bug" use claude-red.
