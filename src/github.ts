import * as core from "@actions/core";
import { Octokit } from "@octokit/rest";
import { getConfig } from "./config";
import { retry } from "@octokit/plugin-retry";

export interface Repository {
	full_name: string;
}

export interface PublicKey {
	key: string;
	key_id: string;
}

export const publicKeyCache = new Map<Repository, PublicKey>();

const RetryOctokit = Octokit.plugin(retry);

// eslint-disable-next-line @typescript-eslint/promise-function-async
export function DefaultOctokit({ ...octokitOptions }): any {
	const retries = getConfig().RETRIES;

	function onRateLimit(retryAfter: any, options: any): boolean {
		core.warning(
			`Request quota exhausted for request ${options.method} ${options.url}`
		);

		if (options.request.retryCount < retries) {
			core.warning(
				`Retrying request ${options.method} ${options.url} after ${retryAfter} seconds!`
			);
			return true;
		}
		core.warning(`Did not retry request ${options.method} ${options.url}`);
		return false;
	}

	function onAbuseLimit(retryAfter: any, options: any): boolean {
		core.warning(`Abuse detected for request ${options.method} ${options.url}`);

		if (options.request.retryCount < retries) {
			core.warning(
				`Retrying request ${options.method} ${options.url} after ${retryAfter} seconds!`
			);
			return true;
		}
		core.warning(`Did not retry request ${options.method} ${options.url}`);
		return false;
	}

	const defaultOptions = {
		throttle: {
			onRateLimit,
			onAbuseLimit,
		},
	};

	return new RetryOctokit({ ...defaultOptions, ...octokitOptions });
}

export async function listAllMatchingRepos({
	patterns,
	octokit,
	affiliation = "owner,collaborator,organization_member",
	pageSize = 30,
}: {
	patterns: string[];
	octokit: any;
	affiliation?: string;
	pageSize?: number;
}): Promise<Repository[]> {
	const repos = await listAllReposForAuthenticatedUser({
		octokit,
		affiliation,
		pageSize,
	});

	core.info(
		`Available repositories: ${JSON.stringify(repos.map((r) => r.full_name))}`
	);

	return filterReposByPatterns(repos, patterns);
}

export async function listAllReposForAuthenticatedUser({
	octokit,
	affiliation,
	pageSize,
}: {
	octokit: any;
	affiliation: string;
	pageSize: number;
}): Promise<Repository[]> {
	const repos: Repository[] = [];

	for (let page = 1; ; page++) {
		const response = await octokit.repos.listForAuthenticatedUser({
			affiliation,
			page,
			pageSize,
		});
		repos.push(...response.data);

		if (response.data.length < pageSize) {
			break;
		}
	}
	return repos;
}

async function listAllRepoFiles({
	octokit,
	repo,
}: {
	octokit: any;
	repo: Repository;
}): Promise<string[]> {
	const latestCommits = await octokit.request("GET /repos/:repo/commits", {
		repo: repo.full_name,
	});

	const commit = await octokit.request("GET /repos/:repo/git/commits/:sha", {
		sha: latestCommits.data[0].sha,
		repo: repo.full_name,
	});

	const tree = await octokit.paginate("GET /repos/:repo/git/trees/:sha", {
		repo: repo.full_name,
		sha: commit.data.tree.sha,
	});

	console.log("tree", JSON.stringify(tree[0].tree, undefined, 2));

	const entries = await octokit.paginate("GET /repos/:repo/contents", {
		repo: repo.full_name,
	});

	const files = entries
		.filter(({ type }: { type: "dir" | "file" }) => type === "file")
		.map(({ path }: { path: string }) => path);

	return files;
}

export function filterReposByPatterns(
	repos: Repository[],
	patterns: string[]
): Repository[] {
	const regexPatterns = patterns.map((s) => new RegExp(s));

	return repos.filter(
		(repo) => regexPatterns.filter((r) => r.test(repo.full_name)).length
	);
}

export async function setFilesForRepo(
	octokit: any,
	files: string[],
	repo: Repository,
	dry_run: boolean
): Promise<void> {
	console.log(
		`REPO (${repo.full_name}) FILES:`,
		await listAllRepoFiles({
			octokit,
			repo,
		})
	);

	if (!dry_run) {
		return Promise.resolve();
	}
}