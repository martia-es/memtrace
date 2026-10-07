# Set up deploys from MemTrace

MemTrace can start the deployment of an assistant with one button, but it never builds or deploys anything itself: it asks **GitHub Actions** to run the workflow of your repository. For that, an administrator sets up a **GitHub App** once. This page is that setup, step by step. What the button does and how the evaluation gate works is in [Assistants catalog](./assistants#an-assistant-s-card).

You need: admin access to the GitHub account that owns the repository, and access to the server (or cluster) where the MemTrace API runs.

## 1. A public address for the webhook

GitHub tells MemTrace how a deployment ended by calling a webhook, so the API must be reachable from the internet. On a server this is your API's own address. **On your laptop** (`make up`) the API only lives on `localhost:3001`, so you need a tunnel. With [ngrok](https://ngrok.com) (a free account gives you one fixed domain):

1. Install it and connect your account: `brew install ngrok`, then `ngrok config add-authtoken <your authtoken>` (the authtoken is on the ngrok dashboard, *Your Authtoken*).
2. Reserve your domain in the dashboard, under *Domains* (something like `your-name.ngrok-free.dev`).
3. Start the tunnel: `make tunel`. It uses the domain in `NGROK_DOMAIN` (change it with `make tunel NGROK_DOMAIN=your-name.ngrok-free.dev`) and prints the webhook URL. Leave it running.

Your **webhook URL** is the address plus the path:

```
https://your-name.ngrok-free.dev/api/v1/webhooks/github
```

Without the path GitHub would call the root of the domain and nothing would answer.

## 2. Create the GitHub App

GitHub → *Settings* → *Developer settings* → *GitHub Apps* → *New GitHub App*.

| Field | Value |
|---|---|
| Homepage URL | Any URL, for example your repository. Only informative |
| Callback URL, Setup URL | **Empty.** MemTrace does not use the App to sign users in. Leave *Request user authorization (OAuth) during installation* and *Expire user authorization tokens* unchecked |
| Webhook → Active | Checked |
| Webhook URL | The one from step 1 |
| Webhook secret | A password you invent: `openssl rand -hex 32`. **Keep it**, you need it again in step 4 |
| Where can it be installed | *Only on this account* |

**Repository permissions** (everything else *No access*):

| Permission | Level | Used for |
|---|---|---|
| Contents | Read-only | Finding the commit a branch points to |
| Actions | Read and write | Starting your workflow and receiving its result |
| Metadata | Read-only | Mandatory; GitHub adds it |

**Subscribe to events:** only **Workflow run**.

Then, on the App's page:

1. Copy the **App ID** (a number at the top).
2. Under *Private keys*, press **Generate a private key**. A `.pem` file downloads.
3. Open *Install App* and install it on your account, choosing **Only select repositories** and the repository of your assistant.

::: warning If you change permissions later
GitHub does not apply them to an existing installation until its owner accepts them: open *Settings → Applications → Installed GitHub Apps → your App* and accept the update. Until then, starting a workflow answers `403`.
:::

## 3. Give MemTrace the credentials

The credentials live in the server's environment, never in the database or the browser. The same three values go in all cases:

| Variable | Value |
|---|---|
| `GITHUB_APP_ID` | The App ID |
| `GITHUB_APP_PRIVATE_KEY` | The content of the `.pem` file (literal `\n` are accepted) |
| `GITHUB_WEBHOOK_SECRET` | The webhook secret from step 2 (**the same string**) |

In the Kubernetes cluster of `make up`, create a Secret by hand (it is not generated from the repository, because the key must not be committed) and restart the API:

```bash
kubectl -n memtrace create secret generic github-app-credentials \
  --from-literal=GITHUB_APP_ID=123456 \
  --from-file=GITHUB_APP_PRIVATE_KEY=./your-app.private-key.pem \
  --from-literal=GITHUB_WEBHOOK_SECRET=<the webhook secret>

kubectl -n memtrace rollout restart deployment/api
```

The restart replaces the API pod, so re-open the port-forward afterwards (`make forward`, or `kubectl port-forward svc/api 3001:3001 -n memtrace`). Without the Secret everything else keeps working and the **Deploy** button answers that it is not configured.

If you mistype it, `kubectl -n memtrace delete secret github-app-credentials` and create it again. Outside Kubernetes, put the three variables in the environment of the API (`api/.env`).

## 4. Make your repository ready

Your workflow must accept three inputs and name its run after the last one, so MemTrace can match GitHub's result with the deployment (the example is in [Assistants catalog](./assistants#an-assistant-s-card)). The workflow file has to exist on the branch MemTrace starts it from. To tag every trace with its commit, add the two lines of [Code version on every trace](../library/configuration#code-version-on-every-trace).

Finally, in the dashboard, edit the assistant: **Source repository** (GitHub, the repository URL and the workflow file name) and, in each environment, the **branch or tag to deploy**. The **Deploy** button appears on environments that have all three, to people with the `deploy:run` permission (the technical role) or the governance permission.

## Check that it works

- **Tunnel and API:** `curl https://your-name.ngrok-free.dev/api/v1/health/ready` answers `200`.
- **Webhook alive:** a POST without signature to the webhook URL answers `401 Invalid signature`. That is the expected answer: the route exists and rejects what GitHub did not sign.
- **Deliveries:** in the App, *Advanced → Recent Deliveries* lists what GitHub sent and what MemTrace answered. A delivery that failed can be re-sent with *Redeliver*.
- **Credentials:** if **Deploy** answers `503`, the three variables are missing in the API; if it answers that the App is not installed, install it on the repository (step 2); `403` on starting the workflow means the new permissions have not been accepted yet.

## Troubleshooting

| What you see | Why |
|---|---|
| A deployment stays on *Deploying* | The webhook did not arrive. Check the tunnel is running, the webhook URL ends in `/api/v1/webhooks/github`, the App is subscribed to *Workflow run* and *Recent Deliveries* has no failures |
| *Recent Deliveries* shows `401` | The webhook secret in the App and the one in the server are not the same string |
| *Recent Deliveries* shows `404` or the tunnel says *endpoint offline* | The API running in the cluster is older than this feature (rebuild with `make api`) or the tunnel is stopped |
| The ngrok domain changes | You are not using a reserved domain. Reserve one, or update the Webhook URL of the App each time |
| The workflow starts but MemTrace says *Failed* | The workflow itself failed; the link of the deployment opens its run in GitHub |
