/*
 * Copyright (c) 2012 Peter Flynn.
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */


/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, brackets, $, window */

define(function (require, exports, module) {
    "use strict";
    
    // Brackets modules
    var CommandManager      = brackets.getModule("command/CommandManager"),
        KeyEvent            = brackets.getModule("utils/KeyEvent"),
        Commands            = brackets.getModule("command/Commands"),
        Menus               = brackets.getModule("command/Menus"),
        KeyBindingManager   = brackets.getModule("command/KeyBindingManager"),
        DocumentManager     = brackets.getModule("document/DocumentManager"),
        ProjectManager      = brackets.getModule("project/ProjectManager"),
        QuickOpen           = brackets.getModule("search/QuickOpen");
    
    
    /** @type {boolean} True during a contiguous sequence of Ctrl+]/[ gestures (while Ctrl held down) */
    var _duringNavigation = false;
    
    
    /** True if given File[Entry] represents an untitled document. Compatible with all Brackets versions */
    function isUntitled(file) {
        var doc = DocumentManager.getOpenDocumentForPath(file.fullPath);
        return doc && doc.isUntitled && doc.isUntitled();
    }
    
    /**
     * @param {string} query User query/filter string
     * @return {Array.<SearchResult>} Sorted and filtered results that match the query
     */
    function search(query, matcher) {
        /* @type {Array.<FileEntry>} */
        var workingSet = DocumentManager.getWorkingSet();
        
        query = query.substr(1);  // lose the "/" prefix
        
        var stringMatch = (matcher && matcher.match) ? matcher.match.bind(matcher) : QuickOpen.stringMatch;
        
        // Filter and rank how good each match is
        var filteredList = $.map(workingSet, function (fileEntry) {
            // Match query against the full project-relative path, like regular Quick Open
            var fullPath, projRelPath;
            if (isUntitled(fileEntry)) {
                // But exclude dummy path of Untitled docs (which regular Quick Open never encounters)
                fullPath = fileEntry.name;
                projRelPath = fullPath;
            } else {
                fullPath = fileEntry.fullPath;
                projRelPath = ProjectManager.makeProjectRelativeIfPossible(fullPath);  // note: might fail & return original abs path
            }
            
            var searchResult = stringMatch(projRelPath, query);
            if (searchResult) {
                searchResult.label = fileEntry.name;
                searchResult.fullPath = fileEntry.fullPath;
            }
            return searchResult;
        });
        
        // Sort based on ranking & basic alphabetical order
        QuickOpen.basicMatchSort(filteredList);

        return filteredList;
    }

    /**
     * @param {string} query
     * @return {boolean} true if this plugin wants to provide results for this query
     */
    function match(query) {
        return query[0] === "/";
    }

    /**
     * @param {SearchResult} selectedItem
     */
    function itemSelect(selectedItem) {
        // Switch to that file
        if (selectedItem) {
            CommandManager.execute(Commands.FILE_OPEN, {fullPath: selectedItem.fullPath});
        }
    }
    
    
    /**
     * @param {SearchResult} fileEntry
     * @param {string} query
     * @return {string}
     */
    function resultFormatter(item, query) {
        // TODO: identical to QuickOpen._filenameResultsFormatter()
        
        // For main label, we just want filename: drop most of the string
        function fileNameFilter(includesLastSegment, rangeText) {
            if (includesLastSegment) {
                var rightmostSlash = rangeText.lastIndexOf('/');
                return rangeText.substring(rightmostSlash + 1);  // safe even if rightmostSlash is -1
            } else {
                return "";
            }
        }
        var displayName = QuickOpen.highlightMatch(item, null, fileNameFilter);
        var displayPath = QuickOpen.highlightMatch(item, "quicksearch-pathmatch");
        
        return "<li>" + displayName + "<br /><span class='quick-open-path'>" + displayPath + "</span></li>";
    }
    
    
    // Register as a new Quick Open mode
    QuickOpen.addQuickOpenPlugin(
        {
            name: "Commands",
            label: "Working Set",  // ignored before Sprint 34
            languageIds: [],  // empty array = all file types  (Sprint 23+)
            fileTypes:   [],  // (< Sprint 23)
            done: function () {},
            search: search,
            match: match,
            itemFocus: function () {},
            itemSelect: itemSelect,
            resultsFormatter: resultFormatter,
            matcherOptions: { segmentedSearch: true }
        }
    );
    
    function beginFileSearch() {
        // Begin Quick Open in our search mode
        QuickOpen.beginSearch("/");
    }
    
    
    /**
     * Returns the next/previous entry in working set UI list order
     * @param {number} inc
     * @return {FileEntry}
     */
    function getRelativeFile(inc) {
        var currentDocument = DocumentManager.getCurrentDocument();
        if (currentDocument) {
            var workingSetI = DocumentManager.findInWorkingSet(currentDocument.file.fullPath);
            if (workingSetI !== -1) {
                var workingSet = DocumentManager.getWorkingSet();
                var switchToI = workingSetI + inc;
                if (switchToI < 0) {
                    switchToI += workingSet.length;
                } else if (switchToI >= workingSet.length) {
                    switchToI -= workingSet.length;
                }
                return workingSet[switchToI];
            }
        }
        
        // If no doc open or working set empty, there is no "next" file
        return null;
    }
    
    
    // End navigation sequence, allowing MRU order to update
    function endDocumentNav(event) {
        if (event.keyCode === KeyEvent.DOM_VK_CONTROL) {
            DocumentManager.finalizeDocumentNavigation();
            
            _duringNavigation = false;
            $(window.document.body).off("keyup", endDocumentNav);
        }
    }
    
    function navigateTo(file) {
        if (file) {
            if (!_duringNavigation) {
                _duringNavigation = true;
                
                // Freeze MRU order until Ctrl keyup so that a quick sequence of contiguous next/prevs
                // don't shuffle around the whole order
                DocumentManager.beginDocumentNavigation();
                $(window.document.body).keyup(endDocumentNav);
            }
            
            CommandManager.execute(Commands.FILE_OPEN, { fullPath: file.fullPath });
        }
    }
    
    function goNextFile() {
        var file = getRelativeFile(+1);
        navigateTo(file);
    }
    function goPrevFile() {
        var file = getRelativeFile(-1);
        navigateTo(file);
    }
    
    
    // Commands for back/forward navigation shortcuts
    var GO_NEXT_COMMAND_ID = "pflynn.goWorkingSetNext";
    var GO_PREV_COMMAND_ID = "pflynn.goWorkingSetPrev";
    CommandManager.register("Next Document in List", GO_NEXT_COMMAND_ID, goNextFile);
    CommandManager.register("Previous Document in List", GO_PREV_COMMAND_ID, goPrevFile);
    
    // Unbind back/forward nav shortcuts from the default indent/unindent commands so we can use them.
    // (They are redundant anyway, since Tab/Shift+Tab do the same thing)
    if (brackets.platform === "mac") {
        // (unlike addBinding(), remove does not automatically map Ctrl to Cmd on Mac - must be explicit)
        KeyBindingManager.removeBinding("Cmd-[");
        KeyBindingManager.removeBinding("Cmd-]");
    } else {
        KeyBindingManager.removeBinding("Ctrl-[");
        KeyBindingManager.removeBinding("Ctrl-]");
    }
    
    // Add menus items in reverse order: we can't use Menus.BEFORE relative to a divider, so
    // use Menus.AFTER on the item just above the divider
    var menu = Menus.getMenu(Menus.AppMenuBar.NAVIGATE_MENU);
    menu.addMenuItem(GO_PREV_COMMAND_ID, "Ctrl-[", Menus.AFTER, Commands.NAVIGATE_PREV_DOC);
    menu.addMenuItem(GO_NEXT_COMMAND_ID, "Ctrl-]", Menus.AFTER, Commands.NAVIGATE_PREV_DOC);
    menu.addMenuDivider(Menus.AFTER, Commands.NAVIGATE_PREV_DOC);
    
    // Command to launch our Quick Open mode
    var SEARCH_WORKING_SET_COMMAND_ID = "pflynn.searchWorkingSetFiles";
    CommandManager.register("Go to Open File", SEARCH_WORKING_SET_COMMAND_ID, beginFileSearch);
    menu.addMenuItem(SEARCH_WORKING_SET_COMMAND_ID, "Ctrl-Shift-E", Menus.AFTER, GO_PREV_COMMAND_ID);
    
});
