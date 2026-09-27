/** Known credential/config paths are never implicitly transferred. This is not a content secret scanner. */
export const sensitiveRepoPath = (path: string) =>
  path
    .split("/")
    .some(
      (part) =>
        /^(?:\.git|\.ssh|\.aws|\.gnupg|\.npmrc|\.pypirc|\.netrc|auth\.json|id_(?:rsa|ed25519|ecdsa)|credentials(?:\.(?:json|ini|ya?ml|toml))?|secrets?(?:\.(?:json|ini|ya?ml|toml|txt))?|.*\.(?:pem|key|p12|pfx))$/i.test(
          part,
        ) ||
        (/^\.env(?:\..*)?$/i.test(part) && !/^\.env\.(?:example|sample|template)$/i.test(part)),
    );
