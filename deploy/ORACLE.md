# Hosting on Oracle Cloud (Always Free)

One small VM runs everything with Docker Compose. A Cloudflare tunnel gives it a public HTTPS link, so you
don't open any ports or buy a domain. The setup has not been run end to end yet, so treat the first
`docker compose up` as a test.

## 1. Create the VM

1. Sign up at https://cloud.oracle.com (a card is required for verification; Always Free resources aren't charged).
2. Compute → Instances → Create instance.
   - Image: **Ubuntu 24.04** (aarch64).
   - Shape: **Ampere A1 Flex**, 2 OCPUs and 12 GB RAM is plenty (the free allowance is 4 OCPUs / 24 GB).
   - Boot volume: 50–100 GB. Add your SSH public key, or let Oracle generate one and download it.
3. "Out of host capacity" is common in popular regions. Retry later or try another availability domain.

## 2. Install Docker on the VM

```bash
ssh ubuntu@<VM_PUBLIC_IP>
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && exit   # log in again so the group applies
```

## 3. Get the project onto the VM with GitHub

On your Mac, once: create an empty **private** repo on GitHub, then push (replace the URL):

```bash
git add -A && git commit -m "Add hosting setup"      # if there is anything uncommitted
git remote add origin https://github.com/Ferhadb/SongToStory.git
git push -u origin master
```

On the VM, install the GitHub CLI so it can read a private repo, then clone:

```bash
sudo apt-get install -y gh
gh auth login                       # choose GitHub.com → HTTPS → log in with the browser code
gh repo clone Ferhadb/SongToStory && cd SongToStory
```

Optional settings go in `.env` on the VM (copy `.env.example`). Spotify and YouTube API keys are optional.

## 4. Start it

```bash
cd ~/SongToStory
docker compose up -d --build        # first build takes several minutes
docker compose logs tunnel | grep trycloudflare
```

Send the `https://….trycloudflare.com` address to your friends. It changes whenever the `tunnel`
container is recreated; `docker compose restart tunnel` also gives a new one.

## Day to day

```bash
docker compose logs -f api          # backend and export errors
git pull && docker compose up -d --build   # after you push changes
docker compose down                 # stop (data is kept in the studio-data volume)
```

## Things to know

- Anyone with the link can use the app and its exports, so only share it with friends. For a permanent
  address and access control, use a named Cloudflare tunnel with Cloudflare Access (free).
- Exports run one at a time on the VM's CPU. A 15-second story takes roughly a minute or two.
- YouTube often blocks downloads from cloud IP addresses. If fetching audio from YouTube fails there, uploading
  an audio file still works.
- If an export fails with a Chromium or sandbox error, check `docker compose logs api` first. That is the
  least tested part on this setup.
- Oracle can reclaim Always Free instances that sit nearly idle for a week. Occasional use is fine.
