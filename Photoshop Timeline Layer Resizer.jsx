#target Photoshop

//
///////////////////////////////////////////////////////////////////////////////
//
// Photoshop Timeline Layer Resizer.jsx - Script to set the animation duration
// of multiple layers in a timeline and optionally reposition the layers in a
// staggered sequence.
//
// Author: https://github.com/horshack-dpreview
//
// Instructions:
//
// 1. Select the layer(s) in your timeline you want to change the direction of
// 2. If you also want to reposition+stagger the resized layers, move the
//    playhead to where you want the first layer to begin
// 3. Run this script in Photoshop via File -> Scripts -> Browse...
// 4. This script will prompt you to enter the new duration in seconds and frames
//    for the selected layers and also ask if you'd like to reposition+stagger
//    the layers.
//
// For faster access to the script (via Photoshop's script menu), copy the script
// to Photoshop's script folder. Example location of the folder on Windows is
// C:\Program Files\Adobe\Adobe Photoshop 2021\Presets\Scripts. Restart PS, after
// which the script can be run via File -> Scripts -> Photoshop Timeline Layer
// Resizer
//
// For even faster access, you can create a keyboard shortcut to the script.
// First copy the script to the PS script folder as instructed above and restart
// PS. Then open the Actions panel and click + to create a new action. Assign an
// available shortkey key and name the action, then press "Record". Click the
// hamburger menu in the Action panel (small icon with four horizontal lines) and
// click "Insert Menu Item...". While the "Insert Menu Item" window is open, go
// to File -> Scripts -> Photoshop Timeline Layer Resizer. Then press OK on the
// "Insert Menu Item" dialog. Press the square stop button in the Action panel to
// complete the action recording. You can now access the script with the shortcut
// key you assigned to it.
//
// Layer stagger example:
//
// Before:
//
// x <- Playhead
// x
// x[Layer 1]
// x[Layer 2]
// x[Layer 3]
//
// After:
//
// x <- Playhead
// x
// x[Layer 1]
// x         [Layer 2]
// x                  [Layer 3]
//

const ScriptName = "Photoshop Timeline Layer Resizer";
const ScriptVersion = "V1.00"

// values for userSettings.repositionLayers
const REPOSITION_LAYERS_NONE                    = 0;
const REPOSITION_LAYERS_AT_PLAYHEAD             = 1;
const REPOSITION_LAYERS_STAGGER_TOP_FIRST       = 2;
const REPOSITION_LAYERS_STAGGER_BOTTOM_FIRST    = 3;


/**
 * Determines if the active document has a background layer
 * @return true if active document has background layer, false if not
 * @see https://feedback.photoshop.com/conversations/photoshop/photoshop-how-to-check-if-document-has-background-layer-with-jsx-javascript-script/5f5f45f44b561a3d426aa1e9?commentId=5f5f48b84b561a3d42353450
 */
function doesActiveDocumentHaveBackgroundLayer() {
    var ref = new ActionReference();
    ref.putProperty( charIDToTypeID("Prpr"), charIDToTypeID("Bckg"));
    ref.putEnumerated(charIDToTypeID("Lyr "),charIDToTypeID("Ordn"),charIDToTypeID("Back"));
    var desc =  executeActionGet(ref);
    return desc.getBoolean(charIDToTypeID("Bckg"));
}


/**
 * Returns an array with indexes of currently selected layers
 * @param fExcludeBackgroundLayer true to exclude background layer from returned array of selected layers
 * @return array of selected layers. array will be empty if there are no selected layers
 * @see https://community.adobe.com/t5/photoshop/how-to-find-selected-layers-and-run-events/td-p/10269273
 */
function getSelectedLayersIndexes(fExcludeBackgroundLayer) {

    var fNoBackgroundLayer = (doesActiveDocumentHaveBackgroundLayer() == false);
    var selectedLayers = new Array;
    var ref = new ActionReference();
    ref.putEnumerated( charIDToTypeID("Dcmn"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt") );
    var desc = executeActionGet(ref);

    if (desc.hasKey(stringIDToTypeID('targetLayers'))) {
        desc = desc.getList(stringIDToTypeID('targetLayers'));
        var c = desc.count
        var selectedLayers = new Array();
        for (var i=0; i<c; i++)
            selectedLayers.push(desc.getReference(i).getIndex() + fNoBackgroundLayer); // biases indexes by +1 if there's no background layer
    } else {
        var ref = new ActionReference();
        ref.putProperty(charIDToTypeID("Prpr"), charIDToTypeID("ItmI"));
        ref.putEnumerated( charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt") );
        selectedLayers.push( executeActionGet(ref).getInteger(charIDToTypeID("ItmI"))-(!fNoBackgroundLayer));
    }
    if (fExcludeBackgroundLayer && selectedLayers.length>0 && selectedLayers[0]==0)
        // caller wants to exclude background layer and there is at least one layer and the
        // 1st layer is a background layer (has index value of 0). return array without index #0
        return selectedLayers.slice(1, selectedLayers.length);

    return selectedLayers;
};


/**
 * Selects layers, using indexes in specified array
 * @param selectedLayers Array containing indexes of layers to select
 */
function selectLayersByIndexes(selectedLayers) {
    var ref = new ActionReference();
    for (var i=0; i<selectedLayers.length; i++)
        ref.putIndex(charIDToTypeID("Lyr "), selectedLayers[i]);
    var desc = new ActionDescriptor();
    desc.putReference(charIDToTypeID("null"), ref);
    desc.putBoolean(charIDToTypeID("MkVs"), false);
    executeAction(charIDToTypeID("slct"), desc, DialogModes.NO);
}

/**
 * Makes a layer active
 * @param index Index of layer to make active
 */
function makeLayerActiveByIndex(index) {
    selectLayersByIndexes([index]);
};


/**
 * Retrieves the current timeline framerate from PS
 * @return Current timeline framerate (double)
 */
function getTimelineFrameRate() {
    var ref = new ActionReference();
    ref.putProperty(charIDToTypeID('Prpr'), stringIDToTypeID('frameRate'));
    ref.putClass(stringIDToTypeID('timeline'));
    var desc = executeActionGet(ref);
    return desc.getDouble(stringIDToTypeID('frameRate'));
}


/**
 * Performs a relative time-adjustment action on the active layer. Supported
 * actions are:
 *  "moveInTime"    - Extends the in point left (negative # seconds/frames) or right (positive # of seconds/frames)
 *  "moveOutTime"   - Extends the out point left (negative # seconds/frames) or right (positive # of seconds/frames)
 *  "moveAllTime"   - Moves the clip left (negative # seconds/frames) or right (positive # seconds/frames)
 * @param moveOperationStr One of the three string values specified above
 * @param seconds Relative number of seconds to adjust
 * @param frames Relative number of frames to adjust
 */
function layerTimelineRelativeAction(moveOperationStr, seconds, frames) {

    var descTimeOffset = new ActionDescriptor();
    descTimeOffset.putInteger(stringIDToTypeID("seconds"), seconds);
    descTimeOffset.putInteger(stringIDToTypeID( "frame"), frames);
    descTimeOffset.putDouble(stringIDToTypeID("frameRate"), getTimelineFrameRate());

    var descMove = new ActionDescriptor();
    descMove.putObject(stringIDToTypeID("timeOffset"), stringIDToTypeID("timecode"), descTimeOffset);

    executeAction(stringIDToTypeID(moveOperationStr), descMove, DialogModes.NO);
}


/**
 * Adjusts the active layer's in point by the relative number of seconds and frames
 * specified. A negative seconds/frames moves the in point left and a positive seconds/frames
 * moves the in point right)
 * @param seconds Number of seconds to move the in point
 * @param frames Number of frames to move the in point
 */
function moveLayerInPointRelative(seconds, frames) {
    layerTimelineRelativeAction("moveInTime", seconds, frames);
}


/**
 * Adjusts the active layer's out point by the relative number of seconds and frames
 * specified. A negative seconds/frames moves theout point left and a positive seconds/frames
 * moves the out point right)
 * @param seconds Number of seconds to move the out point
 * @param frames Number of frames to move the out point
 */
function moveLayerOutPointRelative(seconds, frames) {
    layerTimelineRelativeAction("moveOutTime", seconds, frames);
}


/**
 * Adjusts the active layer's position on the timeline by the relative number of seconds
 * and frames specified. A negative seconds/frames moves the layer left and a positive seconds/frames
 * moves the layer right.
 * @param seconds Number of seconds to move the layer
 * @param frames Number of frames to move the layer
 */

function moveLayerRelative(seconds, frames) {
    layerTimelineRelativeAction("moveAllTime", seconds, frames);
}


/**
  * Gets the current position of the playhead
  * @return Position of the playhead (in frames)
  */
function getPlayheadPosFrame() {
    var ref = new ActionReference();
    ref.putProperty(charIDToTypeID('Prpr'), stringIDToTypeID('currentFrame'));
    ref.putClass(stringIDToTypeID('timeline'));
    var desc = executeActionGet(ref);
    return desc.getDouble(stringIDToTypeID('currentFrame'));
}


/**
 * Entry point into action portion of script, called after the user settings
 * have been obtained in the UI portion of the script
 * @param userSettings Objects describing action and paramters to perform
 */
function scriptActionMain(userSettings) {

    //
    // There is a dearth of documentation regarding available methods to query and
    // change elements on the Photoshop timeline. After multiple web searches and
    // lots of experimentation I was able to establish methods to change the
    // duration and position but not query the existing duration or position of layers.
    //
    // Unfortunately the methods available to change the duration/position are
    // relative to their existing position only, so we have to use creative methods to
    // achieve what we need. For duration, the "moveInTime" and "moveOutTime" actions let
    // us change the in/out points of a frame relative to their current in/out points (ie,
    // subtract a seconds/frame value to extend the existing in point left, or add a
    // seconds/frame value to extend the existing out point right). Since we we can't query
    // a layer's existing in/out points (ie, position) these methods aren't useful for
    // setting the duration to an absolute value. However there's a workaround - if we
    // use "moveOutTime" and specify a very large negative number, we force the out time
    // to be less than the in time - in response, Photoshop will force the out point of the
    // layer to be one frame after the in point, which means this method sets the layer's
    // duration to exactly one frame, starting at the layer's existing in point. We can
    // then use "moveOutTime" with a positive value equal to the absolute duration
    // we want. This workaround allows us to set a layer's duration without changing
    // its position.
    //
    // For position there's the "moveAllTime" action, which lets us alter a layer's position
    // but like "moveInTime" and "moveOutTime" it only works on a relative basis, and
    // since we can't query the layer's existing position it is not useful by itself for
    // moving a clip to an absolute timeline location. If we want to change both a
    // layer's duration and position we first use "moveInTime" with a very large negative
    // number, which Photoshop will adjust so the in point doesn't go negative, meaning it
    // sets the in point to 0. We then use "moveOutTime" to set the layer to the desired
    // duration. Finally, we use "moveAllTime" to move the layer to the desired absolute
    // location (made possible using relative positioning since adjusting the point moved
    // the clip's starting position to frame 0)
    //
    // Note we have no way to set a layer's position without also setting its duration,
    // since the only method we have to move a layer is to change its in/out points as
    // described above, which means we'll change the layer's original duration with no
    // way to get that duration back.
    //

    var selectedLayersIndexes = getSelectedLayersIndexes(true); // UI already verified there's at least one layer selected

    try {
        if (userSettings.repositionLayers == REPOSITION_LAYERS_NONE) {
            //
            // user only wants layer durations to be set, with no change to the layers' positions.
            //
            for (var index=0; index < selectedLayersIndexes.length; index++) {
                makeLayerActiveByIndex(selectedLayersIndexes[index]);
                moveLayerOutPointRelative(-1000000, 0);
                // note we use durationFrames -1 because the seconds/frames count is added to current duration, which we set above to 1 frame
                moveLayerOutPointRelative(userSettings.durationSeconds, userSettings.durationFrames - 1);
            }
        } else {
            //
            // user wants to change layer durations and reposition the layers. we position the first layer starting
            // at the playhead position
            //
            var firstLayerIndex, lastLayerIndexExclusive, layerIndexLoopIncrement;
            var nextLayerPosFrame = getPlayheadPosFrame();
            var layerDurationInFrames = userSettings.durationSeconds * getTimelineFrameRate() + userSettings.durationFrames;
            var framePosAddEachLayer;

            switch (userSettings.repositionLayers) {
            case REPOSITION_LAYERS_AT_PLAYHEAD:
            case REPOSITION_LAYERS_STAGGER_BOTTOM_FIRST:
                firstLayerIndex = 0;
                lastLayerIndexExclusive = selectedLayersIndexes.length;
                layerIndexLoopIncrement = 1;
                framePosAddEachLayer = (userSettings.repositionLayers == REPOSITION_LAYERS_AT_PLAYHEAD ? 0 : layerDurationInFrames);
                break;
            case REPOSITION_LAYERS_STAGGER_TOP_FIRST:
                firstLayerIndex = selectedLayersIndexes.length-1;
                lastLayerIndexExclusive = -1;
                layerIndexLoopIncrement = -1;
                framePosAddEachLayer = layerDurationInFrames;
                break;
            default:
                throw "Unknown userSettings.repositionLayers value of " + userSettings.repositionLayers;
            }

            for (var index=firstLayerIndex; index != lastLayerIndexExclusive; index += layerIndexLoopIncrement, nextLayerPosFrame += framePosAddEachLayer) {
                makeLayerActiveByIndex(selectedLayersIndexes[index]);
                moveLayerInPointRelative(-1000000, 0);
                moveLayerOutPointRelative(-1000000, 0);
                // note we use durationFrames -1 because the seconds/frames count is added to current duration, which we set above to 1 frame
                moveLayerOutPointRelative(userSettings.durationSeconds, userSettings.durationFrames - 1);
                moveLayerRelative(0, nextLayerPosFrame);
            }
        }
    } catch(e) {
        alert("Error setting duration or position of a layer. Perhaps you don't have a video timeline created yet? Or have it set to frame animation (not supported) instead of layer animation?", ScriptName);
        return;
    }

    // restore the user's layer selections
    selectLayersByIndexes(selectedLayersIndexes);
}


/////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////
//
// User-Interface portion of script
//
/////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////

const UserSettingsDataVersion = 1;

/**
 * Creates user settings object with default values
 * @return User settings object
 */
function getDefaultUserSettings() {
    var userSettings = new Object();
    userSettings.dataVersion = UserSettingsDataVersion;
    userSettings.durationSeconds = 1;
    userSettings.durationFrames = 0;
    userSettings.repositionLayers = REPOSITION_LAYERS_NONE;
    return userSettings;
}

/**
 * Creates file object for user settings config file. We use Photoshop's
 * Folder.appData folder, which should point to a reasonable location
 * to store user-specific data. On Windows this is in %systemdrive%\ProgramData
 * @return File object
 */
function createConfigFileObj() {
    return new File(Folder.appData + "/" + ScriptName + "Config.txt");
}

/**
 * Loads user settings from config file, stored from previous invocation
 * of this script. If no previous settings are available then defaults are returned
 */
function loadUserSettingsFromConfigFile() {
    var fileConfig = createConfigFileObj();
    try {
        fileConfig.open("r");
        if (fileConfig.error == "") {
            var userSettings = getDefaultUserSettings(); // get default settings so we can match property names from config file
            for(;;) {
                var line = fileConfig.readln();
                if (fileConfig.error != "")
                    break;
                var fields = line.split(':');
                var prop = fields[0];
                var value = fields[1];
                if (prop in userSettings) // make sure value from file is a setting we know about
                    userSettings[prop] = value;
                else
                    throw "unknown property"; // caught below
            }
            fileConfig.close();
            if (userSettings.dataVersion == UserSettingsDataVersion)
                return userSettings;
            // else mismatched version of user settings (older/newer script creatd them). use defaults
        }
    } catch(e) {
        // config file not created yet or some error in opening/reading it
        $.writeln('hello');
    }
    return getDefaultUserSettings();
}


/**
 * Saves user settings to config file, so they can be used as defaults
 * on next invocation of this script
 * @param userSettings User settings object
 */
function saveUserSettingsToConfigFile(userSettings) {
    var fileConfig = createConfigFileObj();
    try {
        fileConfig.open("w");
        for (var prop in userSettings)
            fileConfig.writeln(prop + ":" + userSettings[prop]);
        fileConfig.close();
    } catch(e) {
        // error saving user settings. preserving settings is a want rather than
        // need, so no real purpose in reporting this error to the user, esp if
        // the issue occurs every time they execute the script
    }
}

/**
 * Entry point for user-interface
 */
function uiMain() {

    /**
      * Validates user text entry as an integer number, presenting an error dialog for invalid values
      * @param entryText User's text entry
      * @param entryTextDescription Description of entry, used for error messsage if value is invalid
      * @return false if value is valid, true otherwise
      */
    function validateNumberEntry(entryText, entryTextDescription) {
        if (isNaN(parseInt(entryText))) {
            alert("Invalid value for " + entryTextDescription + ". Value must a whole number.", ScriptName);
            return true;
        }
        return false;
    }

    // resource string defining our script's UI dialog.
    // modeled from https://www.davidebarranca.com/2012/10/scriptui-window-in-photoshop-palette-vs-dialog/
    var windowResource = "dialog {  \
        orientation: 'column', \
        alignChildren: ['fill', 'top'],  \
        preferredSize:[330, 260], \
        text: 'Photoshop Timeline Layer Resizer',  \
        margins:15, \
        panelDuration: Panel { \
            orientation: 'row', \
            alignChildren: 'right', \
            margins:15, \
            text: ' Layer Duration ', \
            stDuration: StaticText { text: 'Seconds:' }, \
            etDurationSeconds: EditText { text: '0', characters: 5, justify: 'left'} \
            stDuration: StaticText { text: 'Frames:' }, \
            etDurationFrames: EditText { text: '15', characters: 5, justify: 'left'} \
        }, \
        panelRepos: Panel { \
            orientation: 'column', \
            alignChildren: 'left', \
            margins:15, \
            text: ' Reposition Layers ', \
            rbReposNone: RadioButton { text: 'Do Not Reposition', value: true },\
            rbReposAtPlayhead: RadioButton { text: 'To Playhead', value: true },\
            rbReposStaggerTopFirst: RadioButton { text: 'Stagger at Playhead, Top Layer First', value: false },\
            rbReposStaggerBottomFirst: RadioButton { text: 'Stagger at Playhead, Bottom Layer First', value: false },\
        },\
        bottomGroup: Group { \
            cancelButton: Button { text: 'Cancel', properties:{name:'cancel'}, size: [120,24], alignment:['center', 'center'] }, \
            applyButton: Button { text: 'Apply', properties:{name:'ok'}, size: [120,24], alignment:['center', 'center'] }, \
        }\
    }"

    // create window from resource string
    var win = new Window(windowResource);

    // put script name and version in title of window
    win.text = ScriptName + " " + ScriptVersion;

    // load settings from config file if available (otherwise defaults will be returned) and set controls to settings
    var userSettings = loadUserSettingsFromConfigFile();
    win.panelDuration.etDurationSeconds.text = userSettings.durationSeconds;
    win.panelDuration.etDurationFrames.text = userSettings.durationFrames;
    win.panelRepos.rbReposNone.value = (userSettings.repositionLayers == REPOSITION_LAYERS_NONE);
    win.panelRepos.rbReposAtPlayhead.value = (userSettings.repositionLayers == REPOSITION_LAYERS_AT_PLAYHEAD);
    win.panelRepos.rbReposStaggerTopFirst.value = (userSettings.repositionLayers == REPOSITION_LAYERS_STAGGER_TOP_FIRST);
    win.panelRepos.rbReposStaggerBottomFirst.value = (userSettings.repositionLayers == REPOSITION_LAYERS_STAGGER_BOTTOM_FIRST);

    // set focus to first edit field at top of dialog
    win.panelDuration.etDurationSeconds.active = true;

    // define on-click handlers for our Apply and Cancel buttons
    win.bottomGroup.applyButton.onClick = function() {
        // validate user's data entries
        if (validateNumberEntry(win.panelDuration.etDurationSeconds.text, "duration seconds") ||
          validateNumberEntry(win.panelDuration.etDurationFrames.text, "duration frames"))
            return;
        // settings are valid. close dialog, after which values will be processed and action performed
        return win.close(0);
    }
    win.bottomGroup.cancelButton.onClick = function() {
        return win.close(1);
    }

    // present dialog to user
    if (win.show() == 0) {
        // save user's settings to config file so they're used as defaults next time script is run
        userSettings.durationSeconds = parseInt(win.panelDuration.etDurationSeconds.text);
        userSettings.durationFrames = parseInt(win.panelDuration.etDurationFrames.text);
        if (win.panelRepos.rbReposNone.value)
            userSettings.repositionLayers = REPOSITION_LAYERS_NONE;
        else if (win.panelRepos.rbReposAtPlayhead.value)
            userSettings.repositionLayers = REPOSITION_LAYERS_AT_PLAYHEAD;
        else if (win.panelRepos.rbReposStaggerTopFirst.value)
            userSettings.repositionLayers = REPOSITION_LAYERS_STAGGER_TOP_FIRST;
        else
            userSettings.repositionLayers = REPOSITION_LAYERS_STAGGER_BOTTOM_FIRST;
        saveUserSettingsToConfigFile(userSettings);
        return userSettings;
    } else
        return null;
}



/**
 * Script entry point
 */
(function main() {

    var userSettings;

    //
    // make sure the user has a document open and at least one layer is selected
    //
    if (documents.length == 0) {
        alert("There is no open document", ScriptName);
        return;
    }
    if (getSelectedLayersIndexes(true).length == 0) {
        alert("Before running this script please select which layers in your timeline you want to target.", ScriptName);
        return;
    }

    userSettings = uiMain();
    if (userSettings != null)
        app.activeDocument.suspendHistory(ScriptName + " (script)", "scriptActionMain(userSettings)");
    return;
})();
