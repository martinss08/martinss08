const fs = require("node:fs");

const USERNAME = process.env.GITHUB_USERNAME || "martinss08";
const TOKEN = process.env.GITHUB_TOKEN || "";
const API = "https://api.github.com";

const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": `${USERNAME}-readme-updater`,
};

if (TOKEN) {
  headers.Authorization = `Bearer ${TOKEN}`;
}

async function request(url) {
  const response = await fetch(url, { headers });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API error ${response.status} for ${url}: ${body}`);
  }

  const link = response.headers.get("link") || "";
  const data = await response.json();

  return { data, link };
}

async function requestAll(path) {
  const results = [];
  let page = 1;

  while (true) {
    const separator = path.includes("?") ? "&" : "?";
    const { data, link } = await request(`${API}${path}${separator}per_page=100&page=${page}`);
    results.push(...data);

    if (!link.includes('rel="next"')) {
      return results;
    }

    page += 1;
  }
}

function lastPageFromLink(link) {
  const match = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
  return match ? Number(match[1]) : null;
}

async function countRepoCommits(repo) {
  const repoName = encodeURIComponent(repo.name);
  const { data, link } = await request(
    `${API}/repos/${USERNAME}/${repoName}/commits?author=${USERNAME}&per_page=1`
  );

  const lastPage = lastPageFromLink(link);

  if (lastPage !== null) {
    return lastPage;
  }

  return Array.isArray(data) ? data.length : 0;
}

async function countCommits(repos) {
  try {
    const { data } = await request(`${API}/search/commits?q=author:${USERNAME}`);
    if (typeof data.total_count === "number") {
      return data.total_count;
    }
  } catch (error) {
    console.warn(`Busca global de commits indisponivel: ${error.message}`);
  }

  let total = 0;
  const failures = [];

  for (const repo of repos) {
    try {
      total += await countRepoCommits(repo);
    } catch (error) {
      failures.push(`${repo.full_name}: ${error.message}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Contagem de commits incompleta:\n${failures.join("\n")}`);
  }

  return total;
}

function getTopLanguage(repos) {
  const counts = new Map();

  for (const repo of repos) {
    if (!repo.language) continue;
    counts.set(repo.language, (counts.get(repo.language) || 0) + 1);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "Em evolucao";
}

function formatNumber(value) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function replaceSection(readme, name, content) {
  const start = `<!--START_SECTION:${name}-->`;
  const end = `<!--END_SECTION:${name}-->`;
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`);

  if (!pattern.test(readme)) {
    throw new Error(`Marcadores da secao ${name} nao encontrados no README.md`);
  }

  return readme.replace(pattern, `${start}\n${content.trim()}\n${end}`);
}

function buildMetrics({ publicRepos, ownRepos, commitTotal, topLanguage }) {
  return `
<table align="center">
  <tr>
    <td><strong>Repositorios publicos</strong><br>${formatNumber(publicRepos)}</td>
    <td><strong>Projetos proprios</strong><br>${formatNumber(ownRepos)}</td>
    <td><strong>Commits publicos</strong><br>${formatNumber(commitTotal)}</td>
    <td><strong>Linguagem mais usada</strong><br>${topLanguage}</td>
  </tr>
</table>
`;
}

function buildFeaturedProjects(repos) {
  const rows = repos
    .filter((repo) => !repo.fork && !repo.archived)
    .sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at))
    .slice(0, 4)
    .map((repo) => {
      const description = repo.description || "Projeto em evolucao";
      const stack = repo.language || "Codigo";
      return `| [${repo.name}](${repo.html_url}) | ${stack} | ${description.replace(/\|/g, "-")} |`;
    });

  return `| Projeto | Stack | Status |
| --- | --- | --- |
${rows.join("\n")}`;
}

async function main() {
  const [{ data: user }, repos] = await Promise.all([
    request(`${API}/users/${USERNAME}`),
    requestAll(`/users/${USERNAME}/repos?type=owner&sort=updated`),
  ]);

  const ownRepos = repos.filter((repo) => !repo.fork).length;
  const commitTotal = await countCommits(repos.filter((repo) => !repo.fork && !repo.archived));
  const topLanguage = getTopLanguage(repos);

  let readme = fs.readFileSync("README.md", "utf8");

  readme = replaceSection(
    readme,
    "github-metrics",
    buildMetrics({
      publicRepos: user.public_repos,
      ownRepos,
      commitTotal,
      topLanguage,
    })
  );

  readme = replaceSection(readme, "featured-projects", buildFeaturedProjects(repos));

  fs.writeFileSync("README.md", readme);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
