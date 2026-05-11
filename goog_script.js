
function googleTranslateElementInit() {
    new google.translate.TranslateElement({
        pageLanguage: 'en',
        includedLanguages: 'en,nl,fr,de,es,it,pt,sw,ar,zh-CN,ja,ru',
        layout: google.translate.TranslateElement.InlineLayout.SIMPLE,
        autoDisplay: false
    }, 'google_translate_element');

    setTimeout(function() {
        const gadget = document.querySelector('.goog-te-gadget-simple');
        if (!gadget) return;

        let menuWasOpen = false;

        // mousedown fires BEFORE Google's document-level close handler,
        // so we can reliably read whether the menu is open at this moment.
        gadget.addEventListener('mousedown', function() {
            const frame = document.querySelector('.goog-te-menu-frame');
            menuWasOpen = !!(frame && frame.offsetWidth > 0 && frame.offsetHeight > 0);
        });

        // By click time Google has already closed the menu via its own handlers.
        // If it was open, block the click entirely so it doesn't reopen.
        gadget.addEventListener('click', function(e) {
            if (menuWasOpen) {
                e.stopImmediatePropagation();
                e.preventDefault();
                menuWasOpen = false;
            }
        }, true); // capture phase to beat Google's listener

    }, 500);
}
