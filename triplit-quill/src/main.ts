import { TriplitClient } from "@triplit/client";
import { schema } from "../triplit/schema";

const client = new TriplitClient({
  schema,
  serverUrl: import.meta.env.VITE_TRIPLIT_SERVER_URL,
  token: import.meta.env.VITE_TRIPLIT_TOKEN,
});

const bunches = client.query("bunches").build();
client.subscribe(bunches, (results, info) => {
  console.log(results, info);
});
const values = client.query("values").build();
client.subscribe(values, (results, info) => {
  console.log(results, info);
});
