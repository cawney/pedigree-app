import { LibraryScreen } from "./library/LibraryScreen";
import { useRoute } from "./router";
import { ViewerScreen } from "./viewer/ViewerScreen";

export function App() {
  const route = useRoute();
  return route.name === "read" ? <ViewerScreen key={route.id} id={route.id} /> : <LibraryScreen />;
}
