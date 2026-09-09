import { pathToFileURL } from 'node:url'

import { getOctokit } from '@actions/github'

const DEFAULT_API_URL = 'https://web.nexusvpn.ltd/api/internal/client/releases'

const artifactRules = [
  {
    pattern: /_x64_fixed_webview2-setup\.exe$/,
    target: 'windows',
    arch: 'x86_64',
    bundleType: 'nsis-fixed-webview2',
  },
  {
    pattern: /_arm64_fixed_webview2-setup\.exe$/,
    target: 'windows',
    arch: 'aarch64',
    bundleType: 'nsis-fixed-webview2',
  },
  {
    pattern: /_x64-setup\.exe$/,
    target: 'windows',
    arch: 'x86_64',
    bundleType: 'nsis',
  },
  {
    pattern: /_arm64-setup\.exe$/,
    target: 'windows',
    arch: 'aarch64',
    bundleType: 'nsis',
  },
  {
    pattern: /_x86-setup\.exe$/,
    target: 'windows',
    arch: 'i686',
    bundleType: 'nsis',
  },
  {
    pattern: /_x64\.app\.tar\.gz$/,
    target: 'darwin',
    arch: 'x86_64',
    bundleType: 'app',
  },
  {
    pattern: /_aarch64\.app\.tar\.gz$/,
    target: 'darwin',
    arch: 'aarch64',
    bundleType: 'app',
  },
  {
    pattern: /_amd64\.deb$/,
    target: 'linux',
    arch: 'x86_64',
    bundleType: 'deb',
  },
  {
    pattern: /_arm64\.deb$/,
    target: 'linux',
    arch: 'aarch64',
    bundleType: 'deb',
  },
  {
    pattern: /_armhf\.deb$/,
    target: 'linux',
    arch: 'armv7',
    bundleType: 'deb',
  },
  {
    pattern: /-1\.x86_64\.rpm$/,
    target: 'linux',
    arch: 'x86_64',
    bundleType: 'rpm',
  },
  {
    pattern: /-1\.aarch64\.rpm$/,
    target: 'linux',
    arch: 'aarch64',
    bundleType: 'rpm',
  },
  {
    pattern: /-1\.armhfp\.rpm$/,
    target: 'linux',
    arch: 'armv7',
    bundleType: 'rpm',
  },
]

export function classifyArtifact(name) {
  const rule = artifactRules.find(({ pattern }) => pattern.test(name))
  if (!rule) return null

  return {
    target: rule.target,
    arch: rule.arch,
    bundleType: rule.bundleType,
  }
}

async function publishRelease() {
  const githubToken = requireEnv('GITHUB_TOKEN')
  const apiToken = requireEnv('NEXUS_UPDATE_API_TOKEN')
  const repository = process.env.GITHUB_REPOSITORY
  const tag = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME

  if (!repository || !tag) {
    throw new Error(
      'GITHUB_REPOSITORY and RELEASE_TAG (or GITHUB_REF_NAME) are required',
    )
  }

  const [owner, repo] = repository.split('/')
  if (!owner || !repo)
    throw new Error(`Invalid GITHUB_REPOSITORY: ${repository}`)

  const github = getOctokit(githubToken)
  const { data: release } = await github.rest.repos.getReleaseByTag({
    owner,
    repo,
    tag,
  })
  const version = tag.replace(/^v/, '')
  const apiUrl = process.env.NEXUS_UPDATE_API_URL || DEFAULT_API_URL
  const assetsByName = new Map(
    release.assets.map((asset) => [asset.name, asset]),
  )
  const updateAssets = release.assets
    .map((asset) => ({ asset, platform: classifyArtifact(asset.name) }))
    .filter(({ platform }) => platform !== null)

  if (updateAssets.length === 0) {
    throw new Error(`No updater artifacts found in release ${tag}`)
  }

  for (const { asset, platform } of updateAssets) {
    const signatureAsset = assetsByName.get(`${asset.name}.sig`)
    if (!signatureAsset) {
      throw new Error(`Missing signature asset: ${asset.name}.sig`)
    }

    const signature = await downloadSignature(
      signatureAsset.browser_download_url,
    )
    await publishArtifact(apiUrl, apiToken, {
      version,
      ...platform,
      url: asset.browser_download_url,
      signature,
      notes: release.body || undefined,
      pubDate: release.published_at || release.created_at,
      isActive: true,
    })
    console.log(
      `Published ${platform.target}/${platform.arch}/${platform.bundleType}: ${asset.name}`,
    )
  }
}

async function downloadSignature(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download signature (${response.status}): ${url}`)
  }
  return (await response.text()).trim()
}

async function publishArtifact(url, token, artifact) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Admin-Token': token,
    },
    body: JSON.stringify(artifact),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Nexus update API rejected ${artifact.target}/${artifact.arch}/${artifact.bundleType} (${response.status}): ${body}`,
    )
  }
}

function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  publishRelease().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
