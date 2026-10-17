import { render } from "preact";
import { MoxfieldClient, type FetchFn, type SiteHeaders } from "../../moxfield/client";
import { SITE_HEADERS_KEY } from "../../messages";
import { browserStore } from "../../util/store";
import { App } from "./App";
import "./styles.css";

const store = browserStore(browser.storage.local);
const fetchFn: FetchFn = (input, init) => fetch(input, init);
const client = new MoxfieldClient(fetchFn, async () => (await store.get<SiteHeaders>(SITE_HEADERS_KEY)) ?? {});

render(<App client={client} store={store} fetchFn={fetchFn} />, document.getElementById("app")!);
