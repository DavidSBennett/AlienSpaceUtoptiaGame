/**
 * AdminDecksPage — /admin/decks (admin only).
 *
 * Two connected sections on one page:
 *   1. Upload a new deck (author name + deck name + .csv/.xlsx/.xls file)
 *   2. A listing of every deck with card counts and a delete action.
 *
 * Deleting a deck removes it and all its cards, then resets the table
 * AUTO_INCREMENT so deck ids don't keep climbing. Every call here hits an
 * admin-gated endpoint; the route itself is also wrapped in <RequireAuth admin>.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AuthFrame from '../auth/AuthFrame.jsx';
import { adminListDecks, adminUploadDeck, adminDeleteDeck, adminDownloadDeck } from '../api/auth.js';

export default function AdminDecksPage() {
  const [decks, setDecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Upload form
  const [nameFirst, setNameFirst] = useState('');
  const [nameLast, setNameLast] = useState('');
  const [nameDeck, setNameDeck] = useState('');
  const [file, setFile] = useState(null);
  const [fileKey, setFileKey] = useState(0); // bump to reset the <input type=file>
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState(null);

  // Delete confirm + in-flight tracking
  const [confirmingId, setConfirmingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);

  // Export a deck as CSV. The endpoint is Bearer-authenticated, so we fetch the
  // blob through the api client and save it with a temporary object URL rather
  // than linking straight to the PHP file.
  async function handleDownload(deck) {
    setDownloadingId(deck.idDeck);
    setError(null);
    try {
      const blob = await adminDownloadDeck({ idDeck: deck.idDeck });
      const safe = String(deck.nameDeck || 'deck').replace(/[^\w.-]+/g, '_');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safe}-deck-${deck.idDeck}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || 'Download failed.');
    } finally {
      setDownloadingId(null);
    }
  }

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminListDecks();
      setDecks(data.decks || []);
    } catch (err) {
      setError(err.message || 'Could not load decks.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleUpload(e) {
    e.preventDefault();
    setNotice(null);
    setError(null);
    if (!nameDeck.trim()) { setError('Deck name is required.'); return; }
    if (!file) { setError('Choose a .csv, .xlsx, or .xls file.'); return; }
    setUploading(true);
    try {
      const res = await adminUploadDeck({ nameFirst, nameLast, nameDeck, file });
      setNotice(`Imported "${res.nameDeck}" as deck #${res.idDeck} — ${res.card_count} cards.`);
      setNameFirst(''); setNameLast(''); setNameDeck('');
      setFile(null); setFileKey((k) => k + 1);
      await refresh();
    } catch (err) {
      setError(err.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(deck) {
    if (confirmingId !== deck.idDeck) { setConfirmingId(deck.idDeck); return; }
    setConfirmingId(null);
    setDeletingId(deck.idDeck);
    setNotice(null);
    setError(null);
    try {
      const res = await adminDeleteDeck({ idDeck: deck.idDeck });
      setNotice(`Deleted deck #${res.idDeck}. Next deck id is now ${res.decks_next_id}.`);
      await refresh();
    } catch (err) {
      setError(err.message || 'Delete failed.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <AuthFrame
      title="Deck Manager"
      subtitle="Upload, browse, and remove decks"
      eyebrow="Admin"
      footer={<Link to="/" className="btn-primary inline-block">Return to Lobby</Link>}
    >
      <div className="space-y-8">

        {notice && (
          <div className="p-3 bg-verdigris-700/30 border border-verdigris-500 text-verdigris-300 font-serif text-sm">
            {notice}
          </div>
        )}
        {error && (
          <div className="p-3 bg-oxblood-700/30 border border-oxblood-500 text-oxblood-300 font-serif text-sm">
            {error}
          </div>
        )}

        {/* ── Upload ─────────────────────────────────────────── */}
        <section>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 mb-3">
            Upload a new deck
          </div>
          <form onSubmit={handleUpload} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="nameFirst" className="block font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 mb-1">
                  Author first name
                </label>
                <input id="nameFirst" type="text" value={nameFirst}
                  onChange={(e) => setNameFirst(e.target.value)} className="input-dark w-full" />
              </div>
              <div>
                <label htmlFor="nameLast" className="block font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 mb-1">
                  Author last name
                </label>
                <input id="nameLast" type="text" value={nameLast}
                  onChange={(e) => setNameLast(e.target.value)} className="input-dark w-full" />
              </div>
            </div>
            <div>
              <label htmlFor="nameDeck" className="block font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 mb-1">
                Deck name <span className="text-oxblood-300">*</span>
              </label>
              <input id="nameDeck" type="text" maxLength={50} value={nameDeck}
                onChange={(e) => setNameDeck(e.target.value)} className="input-dark w-full" />
            </div>
            <div>
              <label htmlFor="deckFile" className="block font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 mb-1">
                Deck file (.csv, .xlsx, .xls) <span className="text-oxblood-300">*</span>
              </label>
              <input
                key={fileKey}
                id="deckFile"
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-cream-200 font-serif
                           file:mr-3 file:py-2 file:px-4 file:border file:border-gold-500/40
                           file:bg-teal-800 file:text-cream-50 file:font-mono file:text-xs
                           file:uppercase file:tracking-wider hover:file:border-gold-500 file:cursor-pointer"
              />
              <p className="font-serif italic text-cream-200/60 text-xs mt-1">
                Columns A–R, header row first (sequence, date, source type, title, content, significance,
                author, location, argument, sub-argument, bonus, citation, image, contributor, type,
                description, article titles, book titles).
              </p>
            </div>
            <button type="submit" disabled={uploading} className="btn-primary">
              {uploading ? 'Importing…' : 'Upload deck'}
            </button>
          </form>
        </section>

        {/* ── Listing ────────────────────────────────────────── */}
        <section>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 mb-3">
            Existing decks {decks.length > 0 && <span className="text-cream-200/50">({decks.length})</span>}
          </div>

          {loading ? (
            <p className="font-serif italic text-cream-200/70 text-sm">Loading…</p>
          ) : decks.length === 0 ? (
            <p className="font-serif italic text-cream-200/70 text-sm">No decks yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold-400 text-left">
                    <th className="py-2 pr-3">#</th>
                    <th className="py-2 pr-3">Deck</th>
                    <th className="py-2 pr-3">Author</th>
                    <th className="py-2 pr-3 text-right">Cards</th>
                    <th className="py-2 pr-3">Uploaded</th>
                    <th className="py-2 pr-3"></th>
                  </tr>
                </thead>
                <tbody className="font-serif text-cream-100">
                  {decks.map((d) => {
                    const author = [d.nameLast, d.nameFirst].filter(Boolean).join(', ');
                    const confirming = confirmingId === d.idDeck;
                    const deleting = deletingId === d.idDeck;
                    return (
                      <tr key={d.idDeck} className="border-t border-gold-500/20">
                        <td className="py-2 pr-3 font-mono text-cream-200/70">{d.idDeck}</td>
                        <td className="py-2 pr-3 font-display">{d.nameDeck}</td>
                        <td className="py-2 pr-3 text-cream-200/80">{author || '—'}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{d.card_count}</td>
                        <td className="py-2 pr-3 text-cream-200/60 text-xs">
                          {d.timeStamp ? String(d.timeStamp).slice(0, 10) : '—'}
                        </td>
                        <td className="py-2 pr-3 text-right whitespace-nowrap">
                          {confirming ? (
                            <span className="inline-flex items-center gap-2">
                              <button
                                onClick={() => handleDelete(d)}
                                disabled={deleting}
                                className="font-mono text-xs uppercase tracking-wider px-2 py-1
                                           bg-oxblood-700 hover:bg-oxblood-500 text-cream-50
                                           border border-oxblood-300 disabled:opacity-50"
                              >
                                {deleting ? 'Deleting…' : 'Confirm delete'}
                              </button>
                              <button
                                onClick={() => setConfirmingId(null)}
                                disabled={deleting}
                                className="font-mono text-[10px] uppercase tracking-wider text-cream-200/70 hover:text-cream-50 underline"
                              >
                                cancel
                              </button>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-3">
                              <button
                                onClick={() => handleDownload(d)}
                                disabled={downloadingId === d.idDeck}
                                className="font-mono text-xs uppercase tracking-wider text-gold-400 hover:text-gold-300 underline disabled:opacity-50"
                                title="Download this deck as a CSV you can edit and re-upload"
                              >
                                {downloadingId === d.idDeck ? 'Preparing…' : 'Download'}
                              </button>
                              <button
                                onClick={() => handleDelete(d)}
                                className="font-mono text-xs uppercase tracking-wider text-oxblood-300 hover:text-oxblood-200 underline"
                                title="Permanently delete this deck and all its cards"
                              >
                                Delete
                              </button>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="font-serif italic text-cream-200/50 text-xs mt-3">
            Deleting a deck removes it and every card in it, then resets the table numbering so ids stay compact.
          </p>
        </section>
      </div>
    </AuthFrame>
  );
}
