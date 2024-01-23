export async function spaceExists(spaceID: string): Promise<boolean> {
  const spaceExistRes = await fetchJSON('spaceExists', spaceID);
  if (
    spaceExistRes &&
    typeof spaceExistRes === 'object' &&
    typeof spaceExistRes.spaceExists === 'boolean'
  ) {
    return spaceExistRes.spaceExists;
  }
  throw new Error('Bad response from spaceExists');
}

export async function createSpace(spaceID?: string): Promise<string> {
  const createSpaceRes = await fetchJSON('createSpace', spaceID);
  if (
    createSpaceRes &&
    typeof createSpaceRes === 'object' &&
    typeof createSpaceRes.spaceID === 'string'
  ) {
    return createSpaceRes.spaceID;
  }
  throw new Error('Bad response from createSpace');
}

async function fetchJSON(apiName: string, spaceID: string | undefined) {
  const res = await fetch(`/api/replicache/${apiName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body:
      spaceID &&
      JSON.stringify({
        spaceID,
      }),
  });
  return await res.json();
}
