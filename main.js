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
/*global define, brackets, $ */

define(function (require, exports, module) {
    "use strict";
    
    // Brackets modules
    var CommandManager      = brackets.getModule("command/CommandManager"),
        Commands            = brackets.getModule("command/Commands"),
        Menus               = brackets.getModule("command/Menus"),
        DocumentManager     = brackets.getModule("document/DocumentManager"),
        ProjectManager      = brackets.getModule("project/ProjectManager"),
        QuickOpen           = brackets.getModule("search/QuickOpen"),
        StringUtils         = brackets.getModule("utils/StringUtils");
    
    
    
    /**
     * @param {string} query User query/filter string
     * @return {Array.<FileEntry>} Sorted and filtered results that match the query
     */
    function search(query) {
        /* @type {Array.<FileEntry>} */
        var workingSet = DocumentManager.getWorkingSet();
        
        query = query.substr(1);  // lose the "/" prefix
        
        // Filter and rank how good each match is
        var filteredList = $.map(workingSet, function (fileEntry) {
            // match query against filename only (not the full path)
            var searchResult = QuickOpen.stringMatch(fileEntry.name, query);
            if (searchResult) {
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
        if (query.indexOf("/") === 0) {
            return true;
        }
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
        // Virtually identical to QuickOpen._filenameResultsFormatter() - TODO: share code
        query = query.substr(1);  // lose the "/" prefix
        query = StringUtils.htmlEscape(query);
        
        var displayName = StringUtils.htmlEscape(item.label);
        var displayFullPath = StringUtils.htmlEscape(ProjectManager.makeProjectRelativeIfPossible(item.fullPath));
        
        if (query.length > 0) {
            // make query text bold within the item's label
            displayName = displayName.replace(
                new RegExp(StringUtils.regexEscape(query), "gi"),
                "<strong>$&</strong>"
            );
        }
        
        return "<li>" + displayName + "<br /><span class='quick-open-path'>" + displayFullPath + "</span></li>";
    }
    
    
    // Register as a new Quick Open mode
    QuickOpen.addQuickOpenPlugin(
        {
            name: "Commands",
            fileTypes: [],  // empty array = all file types
            done: function () {},
            search: search,
            match: match,
            itemFocus: function () {},
            itemSelect: itemSelect,
            resultsFormatter: resultFormatter
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
    
    function goNextFile() {
        var file = getRelativeFile(+1);
        if (file) {
            CommandManager.execute(Commands.FILE_OPEN, { fullPath: file.fullPath });
        }
    }
    function goPrevFile() {
        var file = getRelativeFile(-1);
        if (file) {
            CommandManager.execute(Commands.FILE_OPEN, { fullPath: file.fullPath });
        }
    }
    

    // Commands for back/forward navigation shortcuts
    var GO_NEXT_COMMAND_ID = "pflynn.goWorkingSetNext";
    var GO_PREV_COMMAND_ID = "pflynn.goWorkingSetPrev";
    CommandManager.register("Next Document in List", GO_NEXT_COMMAND_ID, goNextFile);
    CommandManager.register("Previous Document in List", GO_PREV_COMMAND_ID, goPrevFile);
    
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
