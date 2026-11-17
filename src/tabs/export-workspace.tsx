import Popup from '../popup'
import { useFullPageScroll } from '../hooks/use-full-page-scroll'
import '../styles/export-workspace.css'
export default function ExportWorkspace() {
  useFullPageScroll()
  return <main className="export-workspace"><Popup /></main>
}
