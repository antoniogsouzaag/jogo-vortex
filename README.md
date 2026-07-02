# VÓRTEX — protocolo neon

Jogo arcade em HTML5 Canvas + JavaScript puro (sem build, sem dependências).

## Controles

**Desktop**

| Tecla | Ação |
|---|---|
| WASD / setas | mover |
| Mouse | mirar e atirar |
| Espaço | dash evasivo |
| Shift | câmbio temporal (câmera lenta) |
| Botão direito / Q | pulso gravitacional |
| M | silenciar |
| − / + | volume |
| P / Esc | pausa |

**Celular e tablet (toque)**

- Arraste na metade **esquerda** da tela: direcional virtual de movimento.
- Arraste na metade **direita**: mira e atira na direção do arrasto.
- Sem mirar, a nave **atira sozinha** no inimigo mais próximo.
- Botões na tela: **DASH**, **PULSO**, **FOCO** (segurar p/ câmera lenta) e pausa.
- Volume ajustável pelo slider no menu e na tela de pausa.

## Rodar localmente

Basta abrir o `index.html` no navegador. Se algo não carregar por causa de
restrições de arquivo local, sirva a pasta com um servidor simples:

```bash
npx serve .
```

## Deploy automático (Vercel)

O deploy acontece sozinho a cada `git push`. Configuração única:

1. Suba o projeto para um repositório no GitHub.
2. Acesse [vercel.com](https://vercel.com) e entre com sua conta GitHub.
3. **Add New → Project** e importe este repositório.
4. Framework Preset: **Other** (é site estático puro).
   - Build Command: *deixe vazio*
   - Output Directory: *deixe vazio* (raiz)
5. Clique em **Deploy**.

Pronto. A partir daí, todo `push` na branch principal gera um novo deploy
automaticamente, e cada Pull Request ganha uma URL de preview — tudo sem
consumir minutos do GitHub Actions.
