import { createContext, createMessage } from '../../shared/message-format.js';

(async () => {
    try {
        const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        if (window.location.hostname === 'x.com' && window.location.pathname === '/') {
            console.log('Postscope: on x.com, waiting for redirect to /home...');
            const startTime = Date.now();
            while (window.location.pathname === '/' && (Date.now() - startTime) < 5000) {
                await wait(100);
            }
            if (window.location.pathname === '/') {
                alert('Postscope: Timed out waiting for x.com to redirect. Please try again once you are on your home timeline.');
                return;
            }
        }

        const waitForElement = async (selector, context = document, timeout = 10000) => {
            const start = Date.now();
            while (Date.now() - start < timeout) {
                const el = context.querySelector(selector);
                if (el) return el;
                await wait(200);
            }
            return null;
        };
        // Shared by the root-post capture and the scrape loop so both build messages the same way.
        const extractTweetData = (article) => {
            const tweetTextElement = article.querySelector('[data-testid="tweetText"]');
            const authorHandle = article.querySelector('div[data-testid="User-Name"] a[href^="/"]')?.href.split('/').pop();
            if (!tweetTextElement || !authorHandle) return null;

            const likeButton = article.querySelector('[data-testid="like"]') || article.querySelector('[data-testid="unlike"]');
            const likeAriaLabel = likeButton?.getAttribute('aria-label') || '0';
            const likeMatch = likeAriaLabel.match(/(\d[\d,]*)/);
            const likes = likeMatch ? parseInt(likeMatch[1].replace(/,/g, ''), 10) : 0;
            const timeElement = article.querySelector('time[datetime]');
            const timestamp = timeElement ? timeElement.getAttribute('datetime') : '';

            const avatarImg = article.querySelector('div[data-testid="Tweet-User-Avatar"] img');
            const profilePic = avatarImg ? avatarImg.src : '';

            let postUrl = '';
            if (timeElement) {
                const postLinkElement = timeElement.closest('a');
                if (postLinkElement) postUrl = postLinkElement.href;
            }
            if (!postUrl) {
                const statusLinks = Array.from(article.querySelectorAll('a[href*="/status/"]'));
                const matchingLink = statusLinks.find(l => l.href.includes(`/${authorHandle}/status/`));
                if (matchingLink) postUrl = matchingLink.href;
            }

            const text = tweetTextElement.innerText;
            // id must be stable across separate scrapes of the same post, so a re-scrape dedupes
            // correctly against an earlier export — postUrl (Twitter's own permalink) is that;
            // only fall back to a content-based key when no permalink could be found at all.
            const id = postUrl || (authorHandle + ':' + text.substring(0, 50) + ':' + timestamp);

            return { id, author: authorHandle, text, timestamp, likes, profilePic, postUrl };
        };
        const getPageType = (path) => {
            if (path.startsWith('/search')) {
                const params = new URLSearchParams(window.location.search);
                return { type: 'search', query: params.get('q') || '', filter: params.get('f') };
            }
            if (path.includes('/status/')) return { type: 'post' };
            if (path.endsWith('/home')) return { type: 'home' };
            if (path.startsWith('/explore')) return { type: 'explore' };
            if (path === '/i/bookmarks') return { type: 'bookmarks' };
            if (path.startsWith('/i/communities/')) return { type: 'communities', id: path.split('/')[3] };
            if (path.startsWith('/i/lists/')) return { type: 'list', id: path.split('/')[3] };
            const userCommunitiesMatch = path.match(/^\/([a-zA-Z0-9_]+)\/communities(\/explore)?$/);
            if (userCommunitiesMatch) {
                return { type: userCommunitiesMatch[2] ? 'profile_communities_explore' : 'profile_communities', handle: userCommunitiesMatch[1] };
            }
            const profileMatch = path.match(/^\/([a-zA-Z0-9_]+)(\/(with_replies|highlights|likes|lists))?$/);
            if (profileMatch) {
                const reservedPaths = ['home', 'explore', 'notifications', 'messages', 'i', 'settings', 'communities'];
                if (!reservedPaths.includes(profileMatch[1])) {
                    if (profileMatch[3] === 'lists') {
                        return { type: 'list_hub', handle: profileMatch[1] };
                    }
                    return { type: 'profile', handle: profileMatch[1], subpage: profileMatch[3] || 'tweets' };
                }
            }
            return { type: 'unknown' };
        };
        let path = window.location.pathname;
        if (path.length > 1 && path.endsWith('/')) { path = path.slice(0, -1); }
        const pageInfo = getPageType(path);

        if (pageInfo.type === 'list_hub') {
            alert("Postscope works on individual lists. Please navigate into one of the lists on this page and then click the bookmarklet again.");
            return;
        }

        const supportedPages = ['post', 'home', 'explore', 'bookmarks', 'communities', 'list', 'profile', 'profile_communities', 'profile_communities_explore', 'search'];
        if (!supportedPages.includes(pageInfo.type)) {
            alert('Postscope works on posts, profiles, timelines, searches, lists, and communities. Please navigate to a supported page and try again.');
            return;
        }
        const mainContentArea = await waitForElement('main[role="main"]');
        if (!mainContentArea) {
            alert("Could not find Twitter/X content on this page. Please wait for the page to load and try again.");
            return;
        }
        let userCancelled = false;
        let isPausedForRetry = false;
        let preOpenedWindow = null;

        const updateOverlay = (state, retryCallback) => {
            const statusEl = document.getElementById('postscope-status');
            const overlayContentDiv = statusEl?.parentElement;
            if (!overlayContentDiv) return;

            const oldRetryBtn = document.getElementById('postscope-retry-btn');
            if (oldRetryBtn) oldRetryBtn.remove();

            if (state === 'retry') {
                statusEl.innerHTML = 'Network issue detected.<br>What would you like to do?';
                const retryBtn = document.createElement('button');
                retryBtn.id = 'postscope-retry-btn';
                retryBtn.textContent = 'Retry Loading';
                retryBtn.style.cssText = 'padding: 10px 20px; font-size: 1rem; color: #333; background: #cceeff; border: none; border-radius: 5px; cursor: pointer; margin-right: 10px;';
                retryBtn.onclick = retryCallback;
                overlayContentDiv.insertBefore(retryBtn, document.getElementById('postscope-stop-btn'));
            } else {
                statusEl.innerHTML = '🦠 Noöscope is collecting posts...';
            }
        };
        const createOverlay = () => {
            const overlay = document.createElement('div');
            overlay.id = 'postscope-overlay';
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background-color:rgba(0,0,0,0.7);z-index:99999;display:flex;justify-content:center;align-items:center;color:white;font-family:sans-serif;';
            overlay.innerHTML = `<div style="text-align: center; padding: 20px 40px; background: #222; border-radius: 10px;"><h2 id="postscope-status">🦠 Noöscope is collecting posts...</h2><p id="postscope-hint">Please keep this tab open and in view.</p><p id="postscope-count" style="font-size: 1.2em; font-weight: bold; margin: 15px 0;">Found 0 posts</p><button id="postscope-stop-btn" style="padding: 10px 20px; font-size: 1rem; color: #333; background: #fff; border: none; border-radius: 5px; cursor: pointer; margin-top: 10px;">Stop</button></div>`;
            document.body.appendChild(overlay);

            document.getElementById('postscope-stop-btn').onclick = () => {
                document.getElementById('postscope-status').textContent = 'Finalizing...';
                userCancelled = true;
                // Open window IMMEDIATELY on manual click, before any async gap trips the popup blocker
                preOpenedWindow = window.open('about:blank', '_blank');
            };
            return overlay;
        };
        const updateStatus = (count) => {
            const countEl = document.getElementById('postscope-count');
            if (countEl) countEl.textContent = `Found ${count} posts`;
        };
        const escapeHtml = (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        // No inline <script> here on purpose: a blob: URL inherits its creator's CSP (x.com's,
        // since we build this from inside x.com's page), which blocks inline scripts outright.
        // The download link's href/download get wired from the outer script instead (see showExport) —
        // that's a same-origin DOM property assignment, not script execution, so CSP doesn't apply.
        const buildExportHtml = (data) => {
            const jsonString = JSON.stringify(data, null, 2);
            const label = data.context.source?.author ? ('@' + data.context.source.author) : (data.context.source?.name || data.context.source?.type || 'export');
            const title = '🦠 Noöscope Export — ' + label;
            return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + escapeHtml(title) + '</title><style>' +
                'body{margin:0;padding:24px;background:#fff;color:#111;font-family:-apple-system,BlinkMacSystemFont,sans-serif;}' +
                '#download-btn{display:inline-block;margin-bottom:16px;padding:8px 16px;font-size:0.9rem;font-weight:600;color:#fff;background:#0ea5e9;border-radius:6px;text-decoration:none;cursor:pointer;}' +
                '#download-btn:hover{background:#0284c7;}' +
                'pre{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:0.85rem;line-height:1.5;white-space:pre-wrap;word-break:break-word;}' +
                '</style></head><body>' +
                '<a id="download-btn">Download JSON</a>' +
                '<pre>' + escapeHtml(jsonString) + '</pre>' +
                '</body></html>';
        };

        const source = { type: pageInfo.type, name: '', author: '', text: '', subpage: '', query: '', filter: '' };
        let filterByProfileOwner = false;
        let rootMessage = null;
        if (pageInfo.type === 'list' || pageInfo.type === 'communities') {
            const headerEl = await waitForElement('h2[role="heading"] span', mainContentArea);
            if (headerEl) {
                source.name = headerEl.innerText.trim();
            } else if (pageInfo.type === 'list') {
                const titleMatch = document.title.match(/^(.+?)\s*(\(@\w+\))?\s*\/\s*X$/);
                if (titleMatch && titleMatch[1]) source.name = titleMatch[1].trim();
            }
        } else if (pageInfo.type === 'post') {
            const mainPostArticle = await waitForElement('article[data-testid="tweet"]', mainContentArea);
            if (!mainPostArticle) { alert("Could not find the main post. Please wait for it to load and try again."); return; }
            const rootData = extractTweetData(mainPostArticle);
            if (!rootData) { alert("Could not read the main post. Please wait for it to load and try again."); return; }
            source.author = rootData.author;
            source.text = rootData.text.substring(0, 100) + (rootData.text.length > 100 ? '...' : '');
            // Included as a message too (matching the Bluesky collector, which includes the thread
            // root) rather than only capturing it as source metadata.
            rootMessage = createMessage({
                id: rootData.id,
                author: rootData.author,
                text: rootData.text,
                timestamp: rootData.timestamp,
                metadata: {
                    likes: rootData.likes,
                    profilePic: rootData.profilePic,
                    ...(rootData.postUrl ? { sourceUrl: rootData.postUrl } : {}),
                },
            });
        } else if (pageInfo.type === 'profile') {
            source.author = pageInfo.handle;
            source.subpage = pageInfo.subpage;
            if (pageInfo.subpage !== 'likes') filterByProfileOwner = true;
        } else if (pageInfo.type === 'profile_communities' || pageInfo.type === 'profile_communities_explore') {
            source.author = pageInfo.handle;
        } else if (pageInfo.type === 'search') {
            source.query = pageInfo.query;
            source.filter = pageInfo.filter;
        }
        const context = createContext({ collector: 'twitter', source });
        const overlay = createOverlay();

        const visibleSpinners = new Set();
        const intersectionObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) visibleSpinners.add(entry.target);
                else visibleSpinners.delete(entry.target);
            });
        });
        const mutationObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1) {
                        if (node.matches('[role="progressbar"]')) intersectionObserver.observe(node);
                        node.querySelectorAll('[role="progressbar"]').forEach(spinner => intersectionObserver.observe(spinner));
                    }
                }
            }
        });
        document.querySelectorAll('[role="progressbar"]').forEach(spinner => intersectionObserver.observe(spinner));
        mutationObserver.observe(document.body, { childList: true, subtree: true });

        let previousHeight = -1;
        let previousTweetCount = -1;
        let stuckCount = 0;

        const foundMessages = new Map();
        if (rootMessage) {
            foundMessages.set(rootMessage.id, rootMessage);
            updateStatus(foundMessages.size);
        }

        console.log('Postscope: Scrolling to top to begin collection.');
        window.scrollTo(0, 0);
        await wait(500);

        while (!userCancelled) {
            if (isPausedForRetry) {
                await wait(200);
                continue;
            }
            const cells = mainContentArea.querySelectorAll('div[data-testid="cellInnerDiv"]');
            for (const cell of cells) {
                const article = cell.querySelector('article[data-testid="tweet"]');
                if (!article) continue;

                const adMarker = Array.from(article.querySelectorAll('span')).find(span => span.innerText.trim() === 'Ad');
                if (adMarker) { continue; }

                const data = extractTweetData(article);
                if (!data) continue;
                if (filterByProfileOwner && data.author !== pageInfo.handle) continue;

                if (!foundMessages.has(data.id)) {
                    // Every collected reply parents to the root post. X's conversation DOM has no
                    // "Replying to @x" marker we could find, so there's no reliable way to tell which
                    // specific reply a reply targets — only who replied to the thread, not to whom.
                    const parent = pageInfo.type === 'post' ? rootMessage?.id : undefined;

                    foundMessages.set(data.id, createMessage({
                        id: data.id,
                        author: data.author,
                        text: data.text,
                        timestamp: data.timestamp,
                        parent,
                        metadata: {
                            likes: data.likes,
                            profilePic: data.profilePic,
                            ...(data.postUrl ? { sourceUrl: data.postUrl } : {}),
                        },
                    }));
                    updateStatus(foundMessages.size);
                }
            }

            const retryButtonOnPage = Array.from(document.querySelectorAll('[role="button"]')).find(el => el.innerText.trim() === 'Retry');

            if (retryButtonOnPage) {
                isPausedForRetry = true;
                updateOverlay('retry', () => {
                    if (retryButtonOnPage) retryButtonOnPage.click();
                    updateOverlay('collecting');
                    stuckCount = 0;
                    isPausedForRetry = false;
                });
            }

            // One viewport at a time, not straight to scrollHeight: X virtualizes the timeline,
            // so a big jump (e.g. scrollHeight is already tall because the page was scrolled
            // before the scraper started) unmounts the cells in between and they're never collected.
            window.scrollTo(0, window.scrollY + window.innerHeight);
            await wait(200);

            const currentHeight = document.body.scrollHeight;
            const currentTweetCount = foundMessages.size;
            const isLoading = visibleSpinners.size > 0 && window.scrollY > 100;

            if (isLoading) {
                stuckCount = 0;
            } else if (previousHeight !== -1 && currentHeight <= previousHeight && currentTweetCount === previousTweetCount) {
                stuckCount++;
            } else {
                stuckCount = 0;
            }
            if (stuckCount >= 25) {
                userCancelled = true;
            }
            previousHeight = currentHeight;
            previousTweetCount = currentTweetCount;
        }

        intersectionObserver.disconnect();
        mutationObserver.disconnect();

        // Derive children from the parent pointers assigned during collection.
        for (const message of foundMessages.values()) {
            if (message.parent && foundMessages.has(message.parent)) {
                const parentMessage = foundMessages.get(message.parent);
                (parentMessage.children ??= []).push(message.id);
            }
        }

        if (foundMessages.size > 0) {
            const status = document.getElementById('postscope-status');
            const hint = document.getElementById('postscope-hint');
            const stopBtn = document.getElementById('postscope-stop-btn');

            hint.style.display = 'none';
            status.textContent = 'Collection done.';

            const exportData = { context, messages: Array.from(foundMessages.values()) };

            const showExport = (targetWin) => {
                if (!targetWin || targetWin.closed) {
                    alert('Pop-up blocked! Please allow pop-ups for Postscope.');
                    status.textContent = 'Pop-up blocked.';
                    return;
                }
                const label = source.author ? ('@' + source.author) : (source.name || source.type || 'export');
                const slug = label.toString().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'export';
                const wordsSlug = source.text
                    ? source.text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').split('-').filter(Boolean).slice(0, 2).join('-')
                    : '';
                const count = exportData.messages.length;
                const filename = `twitter-${slug}-${wordsSlug ? wordsSlug + '-' : ''}${count}.json`;

                // Wired from here (same-origin DOM access to targetWin), not via an inline <script> in
                // the generated document — a blob: URL inherits its creator's CSP, and x.com's blocks
                // inline scripts outright. Poll briefly since the blob: navigation is async.
                const wireDownloadButton = () => {
                    if (targetWin.closed) return;
                    const link = targetWin.document && targetWin.document.getElementById('download-btn');
                    if (!link) { setTimeout(wireDownloadButton, 50); return; }
                    const dlBlob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                    link.href = URL.createObjectURL(dlBlob);
                    link.download = filename;
                };

                // Navigate to a real blob: URL (not document.write on about:blank) so Ctrl+S/Save Page As works.
                targetWin.location.href = URL.createObjectURL(new Blob([buildExportHtml(exportData)], { type: 'text/html' }));
                wireDownloadButton();
                status.textContent = 'Done!';
                setTimeout(() => document.getElementById('postscope-overlay')?.remove(), 1500);
            };

            // Logic: If user manually clicked, that window is already open. Else ask for click (avoids popup blockers).
            if (preOpenedWindow) {
                showExport(preOpenedWindow);
            } else {
                stopBtn.textContent = 'Open Results';
                stopBtn.style.backgroundColor = '#0ea5e9';
                stopBtn.style.color = '#ffffff';

                stopBtn.onclick = () => showExport(window.open('about:blank', '_blank'));
            }

        } else {
            document.getElementById('postscope-overlay').remove();
            alert('No posts were collected. Please try again on a page with tweets.');
        }
    } catch (e) {
        console.error(e);
        alert('An error occurred: ' + e.message);
    }
})();
