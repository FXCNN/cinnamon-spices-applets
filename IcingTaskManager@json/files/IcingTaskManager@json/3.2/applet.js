// vim: expandtab shiftwidth=4 tabstop=8 softtabstop=4 encoding=utf-8 textwidth=99
/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
// Cinnamon Window List
// Authors:
//   Kurt Rottmann <kurtrottmann@gmail.com>
//   Jason Siefken
//   Josh hess <jake.phy@gmail.com>
// Taking code from
// Copyright (C) 2011 R M Yorston
// Licence: GPLv2+
// http://intgat.tigress.co.uk/rmy/extensions/gnome-Cinnamon-frippery-0.2.3.tgz

const Applet = imports.ui.applet;
const Lang = imports.lang;
const Cinnamon = imports.gi.Cinnamon;
const St = imports.gi.St;
const Main = imports.ui.main;
const Util = imports.misc.util;
const Signals = imports.signals;
const DND = imports.ui.dnd;
const Settings = imports.ui.settings;
const Gettext = imports.gettext;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const GLib = imports.gi.GLib;
const Gdk = imports.gi.Gdk;
const Meta = imports.gi.Meta;
const SignalManager = imports.misc.signalManager;

const AppletDir = imports.ui.appletManager.applets['IcingTaskManager@json'];

const _ = AppletDir.lodash._;
const each = AppletDir.each.each;
const AppList = AppletDir.appList.AppList;

// Some functional programming tools
const range = function (a, b) {
  let ret = [];
  // if b is unset, we want a to be the upper bound on the range
  if (b === null || b === undefined) { [a, b] = [0, a];
  }

  for (let i = a; i < b; i++) {
    ret.push(i);
  }
  return ret;
};

function PinnedFavs () {
  this._init.apply(this, arguments);
}

PinnedFavs.prototype = {
  _init: function (applet) {
    this._applet = applet;
    this.favoriteSettingKey = 'favorite-apps';
    this._reload();
  },

  _reload: function () {
    if (this._applet.signals.isConnected('changed::favorite-apps', global.settings)) {
      this._applet.signals.disconnect('changed::favorite-apps', global.settings);
    }
    if (this._applet.signals.isConnected('changed::pinned-apps', this._applet.settings)) {
      this._applet.signals.disconnect('changed::pinned-apps', this._applet.settings);
    }
    if (this._applet.systemFavorites) {
      this._applet.signals.connect(global.settings, 'changed::favorite-apps', Lang.bind(this, this._onFavoritesChange));
    } else {
      this._applet.signals.connect(this._applet.settings, 'changed::pinned-apps', Lang.bind(this, this._onFavoritesChange));
    }
    this._favorites = [];
    let ids = [];
    if (this._applet.systemFavorites) {
      ids = global.settings.get_strv(this.favoriteSettingKey);
    } else {
      ids = this._applet.settings.getValue('pinned-apps');
    }
    for (let i = 0, len = ids.length; i < len; i++) {
      let refFav = _.findIndex(this._favorites, {id: ids[i]});
      if (refFav === -1) {
        let app = this._applet._appSystem.lookup_app(ids[i]);
        this._favorites.push({
          id: ids[i],
          app: app
        });
      }
    }
  },

  triggerUpdate: function (appId, pos, isFavoriteApp) {
    let refApp = _.findIndex(this._applet.getCurrentAppList().appList, {appId: appId});
    if (refApp > -1) {
      let currentAppList = this._applet.getCurrentAppList();
      if (!isFavoriteApp && currentAppList.appList[refApp].metaWindows.length === 0) {
        currentAppList.appList[refApp].destroy();
        _.pullAt(currentAppList.appList, refApp);
      } else {
        currentAppList.appList[refApp]._isFavorite(isFavoriteApp);
        currentAppList.managerContainer.set_child_at_index(currentAppList.appList[refApp].actor, pos);
      }
    }
  },

  _saveFavorites: function() {
    this._favorites = _.uniqBy(this._favorites, 'id');
    let ids = _.map(this._favorites, 'id');
    if (this._applet.systemFavorites) {
      global.settings.set_strv(this.favoriteSettingKey, ids);
    } else {
      this._applet.settings.setValue('pinned-apps', ids);
    }
  },

  _onFavoritesChange: function() {
    const oldFavorites = this._favorites;
    this._reload();
    let removedFavorites = _.differenceBy(oldFavorites, this._favorites, 'id');
    each(removedFavorites, (favorite)=>{
      this.triggerUpdate(favorite.id, -1, false);
    });
    each(this._favorites, (favorite, i)=>{
      this.triggerUpdate(favorite.id, i, true);
    });
  },

  _addFavorite: function (opts={appId: null, app: null, pos: -1}) {
    this._applet._appSystem = Cinnamon.AppSystem.get_default();
    if (!opts.app) {
      opts.app = this._applet._appSystem.lookup_app(opts.appId);
    }
    if (!opts.app) {
      opts.app = this._applet._appSystem.lookup_settings_app(opts.appId);
    }
    if (!opts.app) {
      opts.app = this._applet._appSystem.lookup_desktop_wmclass(opts.appId);
    }
    if (!opts.app) {
      return false;
    }
    if (!opts.pos) {
      opts.pos = -1;
    }

    let newFav = {
      id: opts.appId,
      app: opts.app
    };
    this._favorites.push(newFav);

    if (opts.pos !== -1) {
      this.moveFavoriteToPos(opts.appId, opts.pos);
      return true;
    }

    this._saveFavorites();
    return true;
  },

  moveFavoriteToPos: function (appId, pos) {
    let oldIndex = _.findIndex(this._favorites, {id: appId});
    if (oldIndex !== -1 && pos > oldIndex) {
      pos = pos - 1;
    }
    this._favorites.splice(pos, 0, this._favorites.splice(oldIndex, 1)[0]);
    this._saveFavorites();
  },

  removeFavorite: function (appId) {
    let refFav = _.findIndex(this._favorites, {id: appId});
    this.triggerUpdate(appId, -1, false);
    _.pullAt(this._favorites, refFav);
    this._saveFavorites();
    return true;
  },
};
Signals.addSignalMethods(PinnedFavs.prototype);

function MyApplet (metadata, orientation, panel_height, instance_id) {
  this._init(metadata, orientation, panel_height, instance_id);
}

MyApplet.prototype = {
  __proto__: Applet.Applet.prototype,

  _init: function (metadata, orientation, panel_height, instance_id) {
    Applet.Applet.prototype._init.call(this, orientation, panel_height, instance_id);
    this.orientation = orientation;
    this._uuid = metadata.uuid;
    this.settings = new Settings.AppletSettings(this, this._uuid, instance_id);
    this.signals = new SignalManager.SignalManager(this);
    this.tracker = Cinnamon.WindowTracker.get_default();
    this._appSystem = Cinnamon.AppSystem.get_default();
    this.recentManager = Gtk.RecentManager.get_default();
    this.sortRecentItems(this.recentManager.get_items());
    this._monitorWatchList = [];
    this.metaWorkspaces = [];
    this.autostartApps = [];
    this._menuOpen = false;
    this.forceRefreshList = false;
    this._dragPlaceholder = null;
    this._dragPlaceholderPos = -1;
    this._animatingPlaceholdersCount = 0;
    this.homeDir = GLib.get_home_dir();
    this.appletEnabled = false;
    this.actor.set_track_hover(false);
    this._box = new St.Bin();
    this.actor.add(this._box);

    // Declare vertical panel compatibility
    this.setAllowedLayout(Applet.AllowedLayout.BOTH);

    this.execInstallLanguage();
    Gettext.bindtextdomain(this._uuid, GLib.get_home_dir() + '/.local/share/locale');

    let settingsProps = [
      {key: 'show-pinned', value: 'showPinned', cb: this.refreshCurrentAppList},
      {key: 'show-active', value: 'showActive', cb: this.refreshCurrentAppList},
      {key: 'show-alerts', value: 'showAlerts', cb: this._updateAttentionState},
      {key: 'group-apps', value: 'groupApps', cb: this.refreshCurrentAppList},
      {key: 'enable-app-button-dragging', value: 'enableDragging', cb: null},
      {key: 'pinOnDrag', value: 'pinOnDrag', cb: null},
      {key: 'pinned-apps', value: 'pinnedApps', cb: null},
      {key: 'middle-click-action', value: 'middleClickAction', cb: null},
      {key: 'show-apps-order-hotkey', value: 'showAppsOrderHotkey', cb: this._bindAppKey},
      {key: 'show-apps-order-timeout', value: 'showAppsOrderTimeout', cb: null},
      {key: 'cycleMenusHotkey', value: 'cycleMenusHotkey', cb: this._bindAppKey},
      {key: 'hoverPseudoClass', value: 'hoverPseudoClass', cb: null},
      {key: 'focusPseudoClass', value: 'focusPseudoClass', cb: null},
      {key: 'activePseudoClass', value: 'activePseudoClass', cb: null},
      {key: 'enable-hover-peek', value: 'enablePeek', cb: null},
      {key: 'onclick-thumbnails', value: 'onClickThumbs', cb: null},
      {key: 'hover-peek-opacity', value: 'peekOpacity', cb: null},
      {key: 'hover-peek-time', value: 'peekTime', cb: null},
      {key: 'thumbnail-timeout', value: 'thumbTimeout', cb: null},
      {key: 'thumbnail-size', value: 'thumbSize', cb: null},
      {key: 'sort-thumbnails', value: 'sortThumbs', cb: this._updateThumbnailOrder},
      {key: 'vertical-thumbnails', value: 'verticalThumbs', cb: this._updateVerticalThumbnailState},
      {key: 'show-thumbnails', value: 'showThumbs', cb: this.refreshThumbnailsFromCurrentAppList},
      {key: 'animate-thumbnails', value: 'animateThumbs', cb: null},
      {key: 'close-button-style', value: 'thumbCloseBtnStyle', cb: this.refreshCurrentAppList},
      {key: 'include-all-windows', value: 'includeAllWindows', cb: this.refreshCurrentAppList},
      {key: 'number-display', value: 'numDisplay', cb: this._updateWindowNumberState},
      {key: 'title-display', value: 'titleDisplay', cb: this.refreshCurrentAppList},
      {key: 'icon-spacing', value: 'iconSpacing', cb: this._updateSpacingOnAllAppLists},
      {key: 'enable-iconSize', value: 'enableIconSize', cb: this._updateIconSizes},
      {key: 'icon-size', value: 'iconSize', cb: this._updateIconSizes},
      {key: 'show-recent', value: 'showRecent', cb: null},
      {key: 'menuItemType', value: 'menuItemType', cb: null},
      {key: 'firefox-menu', value: 'firefoxMenu', cb: null},
      {key: 'autostart-menu-item', value: 'autoStart', cb: null},
      {key: 'monitor-move-all-windows', value: 'monitorMoveAllWindows', cb: null},
      {key: 'app-button-width', value: 'appButtonWidth', cb: this._updateAppButtonWidths},
      {key: 'system-favorites', value: 'systemFavorites', cb: this._updateFavorites},
      {key: 'list-monitor-windows', value: 'listMonitorWindows', cb: this.refreshCurrentAppList},
    ];

    for (let i = 0, len = settingsProps.length; i < len; i++) {
      this.settings.bind(settingsProps[i].key, settingsProps[i].value, settingsProps[i].cb);
    }

    this.pinnedFavorites = new PinnedFavs(this);

    this.signals.connect(global.window_manager, 'switch-workspace', Lang.bind(this, this._onSwitchWorkspace));
    this.signals.connect(global.screen, 'notify::n-workspaces', Lang.bind(this, this._onWorkspaceCreatedOrDestroyed));
    this.signals.connect(global.screen, 'window-monitor-changed', Lang.bind(this, this._onWindowMonitorChanged));
    this.signals.connect(global.screen, 'monitors-changed', Lang.bind(this, this.on_applet_instances_changed));
    this.signals.connect(global.display, 'window-marked-urgent', Lang.bind(this, this._updateAttentionState));
    this.signals.connect(global.display, 'window-demands-attention', Lang.bind(this, this._updateAttentionState));
    this.signals.connect(global.settings, 'changed::panel-edit-mode', Lang.bind(this, this.on_panel_edit_mode_changed));
    this.signals.connect(Main.overview, 'showing', Lang.bind(this, this._onOverviewShow));
    this.signals.connect(Main.overview, 'hiding', Lang.bind(this, this._onOverviewHide));
    this.signals.connect(Main.expo, 'showing', Lang.bind(this, this._onOverviewShow));
    this.signals.connect(Main.expo, 'hiding', Lang.bind(this, this._onOverviewHide));
    this.signals.connect(Main.themeManager, 'theme-set', Lang.bind(this, this.refreshCurrentAppList));
    this.signals.connect(this.tracker, 'notify::focus-app', Lang.bind(this, this._updateFocusState));

    this.getAutostartApps();
    // Query apps for the current workspace
    this.currentWs = global.screen.get_active_workspace_index();
    this._onSwitchWorkspace();
    this._bindAppKey();
  },

  on_applet_instances_changed: function() {
    let numberOfMonitors = Gdk.Screen.get_default().get_n_monitors();
    let onPrimary = this.panel.monitorIndex === Main.layoutManager.primaryIndex;
    let instances = Main.AppletManager.getRunningInstancesForUuid(this._uuid);

    /* Simple cases */
    if (numberOfMonitors === 1) {
      this._monitorWatchList = [Main.layoutManager.primaryIndex];
    } else if (instances.length > 1 && !onPrimary) {
      this._monitorWatchList = [this.panel.monitorIndex];
    } else {
      /* This is an instance on the primary monitor - it will be
       * responsible for any monitors not covered individually.  First
       * convert the instances list into a list of the monitor indices,
       * and then add the monitors not present to the monitor watch list
       * */
      this._monitorWatchList = [this.panel.monitorIndex];

      instances = _.map(instances, function(instance) {
        return instance.panel.monitorIndex;
      });

      for (let i = 0; i < numberOfMonitors; i++) {
        if (instances.indexOf(i) === -1) {
          this._monitorWatchList.push(i);
        }
      }
    }
    this.refreshCurrentAppList();
  },

  on_panel_edit_mode_changed: function () {
    this.panelEditMode = global.settings.get_boolean('panel-edit-mode');
    each(this.metaWorkspaces, (workspace)=>{
      each(workspace.appList.appList, (appGroup)=>{
        appGroup.hoverMenu.actor.reactive = !this.panelEditMode;
        appGroup.hoverMenu.appSwitcherItem.actor.reactive = !this.panelEditMode;
        appGroup.rightClickMenu.actor.reactive = !this.panelEditMode;
        appGroup._appButton.actor.reactive = !this.panelEditMode;
      });
    });
  },

  on_panel_height_changed: function() {
    this.refreshCurrentAppList();
  },

  on_orientation_changed: function(orientation) {
    this.metaWorkspaces[this.currentWs].appList.on_orientation_changed(orientation);
  },

  on_applet_removed_from_panel: function() {
    this.signals.disconnectAllSignals();
  },

  // Override Applet._onButtonPressEvent due to the applet menu being replicated in AppMenuButtonRightClickMenu.
  _onButtonPressEvent: function(actor, event) {
    if (this.panelEditMode) {
      Applet.Applet.prototype._onButtonPressEvent.call(this, actor, event);
    }
    return false;
  },

  _onWindowMonitorChanged: function(screen, metaWindow, metaWorkspace) {
    if (this.listMonitorWindows) {
      this.getCurrentAppList()._windowRemoved(metaWorkspace, metaWindow);
      this.getCurrentAppList()._windowAdded(metaWorkspace, metaWindow);
    }
  },

  _bindAppKey: function(){
    this._unbindAppKey();
    let addLaunchHotkeys = (i)=>{
      Main.keybindingManager.addHotKey('launch-app-key-' + i, '<Super>' + i, () => this._onAppKeyPress(i));
      Main.keybindingManager.addHotKey('launch-new-app-key-' + i, '<Super><Shift>' + i, () => this._onNewAppKeyPress(i));
    };

    for (let i = 1; i < 10; i++) {
      addLaunchHotkeys(i.toString());
    }
    Main.keybindingManager.addHotKey('launch-show-apps-order', this.showAppsOrderHotkey, ()=>this._showAppsOrder());
    Main.keybindingManager.addHotKey('launch-cycle-menus', this.cycleMenusHotkey, ()=>this._cycleMenus());
  },

  _unbindAppKey: function(){
    for (let i = 1; i < 10; i++) {
      let _i = i.toString();
      Main.keybindingManager.removeHotKey('launch-app-key-' + _i);
      Main.keybindingManager.removeHotKey('launch-new-app-key-' + _i);
    }
    Main.keybindingManager.removeHotKey('launch-show-apps-order');
    Main.keybindingManager.removeHotKey('launch-cycle-menus');
  },

  _onAppKeyPress: function(number){
    this.getCurrentAppList()._onAppKeyPress(number);
  },

  _onNewAppKeyPress: function(number){
    this.getCurrentAppList()._onNewAppKeyPress(number);
  },

  _showAppsOrder: function(){
    this.getCurrentAppList()._showAppsOrder();
  },

  _cycleMenus: function(){
    this.getCurrentAppList()._cycleMenus();
  },

  refreshCurrentAppList: function(){
    this.metaWorkspaces[this.currentWs].appList._refreshList();
  },

  handleMintYThemePreset: function() {
    this.settings.setValue('hoverPseudoClass', 1);
    this.settings.setValue('focusPseudoClass', 1);
    this.settings.setValue('activePseudoClass', 3);
    this.settings.setValue('number-display', 1);
    this.settings.setValue('show-active', true);
  },

  _updateFavorites: function() {
    this.pinnedFavorites._reload();
    this.refreshCurrentAppList();
  },

  _updateThumbnailOrder: function() {
    each(this.metaWorkspaces, (workspace)=>{
      each(workspace.appList.appList, (appGroup)=>{
        appGroup.hoverMenu.appSwitcherItem.addWindowThumbnails();
      });
    });
  },

  _updateIconSizes: function () {
    each(this.metaWorkspaces, (workspace)=>{
      each(workspace.appList.appList, (appGroup)=>{
        appGroup._appButton.setIconSize();
        appGroup._appButton.setIconPadding();
      });
    });
  },

  _updateAppButtonWidths: function() {
    each(this.metaWorkspaces, (workspace)=>{
      each(workspace.appList.appList, (appGroup)=>{
        appGroup._appButton.setActorWidth();
      });
    });
  },

  _updateSpacingOnAllAppLists: function() {
    each(this.metaWorkspaces, (workspace)=>{
      workspace.appList._updateSpacing();
    });
  },

  _updateWindowNumberState: function() {
    each(this.metaWorkspaces, (workspace)=>{
      workspace.appList._calcAllWindowNumbers();
    });
  },

  _updateFocusState: function() {
    each(this.metaWorkspaces, (workspace)=>{
      workspace.appList._updateFocusState();
    });
  },

  _updateAttentionState: function(display, window) {
    if (!this.showAlerts) {
      return false;
    }
    each(this.metaWorkspaces, (workspace)=>{
      workspace.appList._updateAttentionState(display, window);
    });
  },

  _updateVerticalThumbnailState: function() {
    each(this.metaWorkspaces, (workspace)=>{
      each(workspace.appList.appList, (appGroup)=>{
        appGroup.hoverMenu.appSwitcherItem._setVerticalSetting();
      });
    });
  },

  refreshThumbnailsFromCurrentAppList: function(){
    this.metaWorkspaces[this.currentWs].appList._refreshAllThumbnails();
  },

  getAppFromWMClass: function(specialApps, metaWindow) {
    let startupClass = (wmclass)=> {
      let app_final = null;
      for (let i = 0, len = specialApps.length; i < len; i++) {
        if (specialApps[i].wmClass === wmclass) {
          app_final = this._appSystem.lookup_app(specialApps[i].id);
          if (!app_final) {
            app_final = this._appSystem.lookup_settings_app(specialApps[i].id);
          }
          app_final.wmClass = wmclass;
        }
      }
      return app_final;
    };
    let wmClassInstance = metaWindow.get_wm_class_instance();
    let app = startupClass(wmClassInstance);
    return app;
  },

  getCurrentAppList: function(){
    if (typeof this.metaWorkspaces[this.currentWs] !== 'undefined') {
      return this.metaWorkspaces[this.currentWs].appList;
    } else if (typeof this.metaWorkspaces[0] !== 'undefined') {
      return this.metaWorkspaces[0].appList;
    } else {
      global.logError('ITM Error: Could not retrieve the current app list.');
      return null;
    }
  },

  getAutostartApps: function(){
    let info, autoStartDir;

    let getChildren = ()=>{
      let children = autoStartDir.enumerate_children('standard::name,standard::type,time::modified', Gio.FileQueryInfoFlags.NONE, null);
      while ((info = children.next_file(null)) !== null) {
        if (info.get_file_type() === Gio.FileType.REGULAR) {
          let name = info.get_name();
          let file = Gio.file_new_for_path(this.autostartStrDir + '/' + name);
          this.autostartApps.push({id: name, file: file});
        }
      }
    };

    this.autostartStrDir = this.homeDir + '/.config/autostart';
    autoStartDir = Gio.file_new_for_path(this.autostartStrDir);

    if (autoStartDir.query_exists(null)) {
      getChildren();
    } else {
      Util.spawnCommandLineAsync('bash -c "mkdir ' + this.autostartStrDir + '"', () => getChildren());
    }
  },

  removeAutostartApp: function(autostartIndex){
    _.pullAt(this.autostartApps, autostartIndex);
  },

  execInstallLanguage: function() {
    let moPath = this.homeDir + '/.local/share/cinnamon/applets/' + this._uuid + '/generate_mo.sh';
    let moFile = Gio.file_new_for_path(this.homeDir + '/.local/share/locale/de/LC_MESSAGES/IcingTaskManager@json.mo');
    if (!moFile.query_exists(null)) {
      Util.trySpawnCommandLine('bash -c "' + moPath + '"');
    }
  },

  handleDragOver: function (source, actor, x, y) {
    if (!(source.isDraggableApp || (source instanceof DND.LauncherDraggable))
      || !this.enableDragging) {
      return DND.DragMotionResult.NO_DROP;
    }

    let children = this.metaWorkspaces[this.currentWs].appList.managerContainer.get_children();
    let windowPos = children.indexOf(source.actor);

    let pos = 0;

    let isVertical = this.metaWorkspaces[this.currentWs].appList.managerContainer.height > this.metaWorkspaces[this.currentWs].appList.managerContainer.width;
    let axis = isVertical ? [y, 'y1'] : [x, 'x1'];
    each(children, (child, i)=>{
      if (axis[0] > children[i].get_allocation_box()[axis[1]] + children[i].width / 2) {
        pos = i;
      }
    });

    if (pos !== this._dragPlaceholderPos) {
      this._dragPlaceholderPos = pos;

      // Don't allow positioning before or after self
      if (windowPos !== -1 && pos === windowPos) {
        if (this._dragPlaceholder) {
          this._dragPlaceholder.animateOutAndDestroy();
          this._animatingPlaceholdersCount++;
          this._dragPlaceholder.actor.connect('destroy', Lang.bind(this, function () {
            this._animatingPlaceholdersCount--;
          }));
        }
        this._dragPlaceholder = null;

        return DND.DragMotionResult.CONTINUE;
      }

      // If the placeholder already exists, we just move
      // it, but if we are adding it, expand its size in
      // an animation
      let fadeIn;
      if (this._dragPlaceholder) {
        this._dragPlaceholder.actor.destroy();
        fadeIn = false;
      } else {
        fadeIn = true;
      }

      let childWidth;
      let childHeight;
      if (source.isDraggableApp) {
        childWidth = 30;
        childHeight = 24;
      } else {
        childWidth = source.actor.width;
        childHeight = source.actor.height;
      }
      this._dragPlaceholder = new DND.GenericDragPlaceholderItem();
      this._dragPlaceholder.child.width = childWidth;
      this._dragPlaceholder.child.height = childHeight;
      this.metaWorkspaces[this.currentWs].appList.managerContainer.insert_child_at_index(this._dragPlaceholder.actor, this._dragPlaceholderPos);

      if (fadeIn) {
        this._dragPlaceholder.animateIn();
      }
    }

    return DND.DragMotionResult.MOVE_DROP;
  },

  acceptDrop: function (source, actor, x) {
    if (!(source.isDraggableApp
      || (source instanceof DND.LauncherDraggable))
      || this.panelEditMode
      || !this.enableDragging) {
      return false;
    }

    if (!(source.isFavoriteApp || source.wasFavapp || source.isDraggableApp || (source instanceof DND.LauncherDraggable)) || source.isNotFavapp) {
      if (this._dragPlaceholderPos !== -1) {
        this.metaWorkspaces[this.currentWs].appList.managerContainer.set_child_at_index(source.actor, this._dragPlaceholderPos);
      }
      this._clearDragPlaceholder();
    }
    this.metaWorkspaces[this.currentWs].appList.managerContainer.set_child_at_index(source.actor, this._dragPlaceholderPos);

    let app = source.app;

    // Don't allow favoriting of transient apps
    if (!app || app.is_window_backed()) {
      return false;
    }

    let id = app.get_id();
    if (app.is_window_backed()) {
      id = app.get_name().toLowerCase() + '.desktop';
    }

    let favorites = this.pinnedFavorites._favorites;
    let refFav = _.findIndex(favorites, {id: id});
    let favPos = this._dragPlaceholderPos;

    if (favPos === -1) {
      let children = this.metaWorkspaces[this.currentWs].appList.managerContainer.get_children();
      let pos = 0;
      for (let i = 0, len = children.length; i < len; i++) {
        if (x > children[i].get_allocation_box().x1 + children[i].width / 2) {
          pos = i;
        }
      }
      if (pos !== this._dragPlaceholderPos) {
        favPos = pos;
      }
    }

    Meta.later_add(Meta.LaterType.BEFORE_REDRAW, Lang.bind(this, function () {
      if (refFav !== -1) {
        this.pinnedFavorites.moveFavoriteToPos(id, favPos);
      } else if (this.pinOnDrag) {
        this.pinnedFavorites._addFavorite({appId: id, app: app, pos: favPos});
      }
      return false;
    }));
    this._clearDragPlaceholder();
    return true;
  },

  _clearDragPlaceholder: function () {
    if (this._dragPlaceholder) {
      this._dragPlaceholder.animateOutAndDestroy();
      this._dragPlaceholder = null;
      this._dragPlaceholderPos = -1;
    }
  },

  acceptNewLauncher: function (path) {
    this.pinnedFavorites._addFavorite({appId: path, pos: -1});
  },

  sortRecentItems: function (items) {
    this.recentItems = items.sort(function (a, b) { return a.get_modified() - b.get_modified(); }).reverse();
    return this.recentItems;
  },

  _onWorkspaceCreatedOrDestroyed: function (i) {
    let workspaces = _.filter(global.screen.get_workspace_by_index(i), (ws, key)=>{
      return key in range(global.screen.n_workspaces);
    });

    // We'd like to know what workspaces in this.metaWorkspaces have been destroyed and
    // so are no longer in the workspaces list.  For each of those, we should destroy them
    for (let i = 0, len = this.metaWorkspaces.length; i < len; i++) {
      if (workspaces.indexOf(this.metaWorkspaces[i].ws) === -1) {
        this.metaWorkspaces[i].appList.destroy();
        _.pullAt(this.metaWorkspaces, i);
      }
    }
  },

  _onSwitchWorkspace: function () {
    this.currentWs = global.screen.get_active_workspace_index();
    let metaWorkspace = global.screen.get_workspace_by_index(this.currentWs);

    // If the workspace we switched to isn't in our list,
    // we need to create an AppList for it
    let refWorkspace = _.findIndex(this.metaWorkspaces, {index: this.currentWs});
    let appList;
    if (refWorkspace === -1) {
      appList = new AppList(this, metaWorkspace);
      this.metaWorkspaces.push({
        ws: metaWorkspace,
        appList: appList,
        index: this.currentWs,
      });
    }

    // this.actor can only have one child, so setting the child
    // will automatically unparent anything that was previously there, which
    // is exactly what we want.
    let list = refWorkspace !== -1 ? this.metaWorkspaces[refWorkspace].appList : appList;
    this._box.set_child(list.actor);
    list._refreshList();
  },

  _onOverviewShow: function () {
    this.actor.hide();
  },

  _onOverviewHide: function () {
    this.actor.show();
  },

  destroy: function () {
    this._unbindAppKey();
    this.signals.disconnectAllSignals();
    for (let i = 0, len = this.metaWorkspaces.length; i < len; i++) {
      let children = this.metaWorkspaces[i].appList.managerContainer.get_children();
      for (let z = 0, len = children.length; z < len; z++) {
        this.metaWorkspaces[i].appList.managerContainer.remove_actor(children[z]);
        children[z].destroy();
      }
      this.metaWorkspaces[i].appList.destroy();
    }

    this.actor.remove_actor(this._box);
    this._box.destroy_children();
    this._box.destroy();

    this.actor.destroy();
    this.actor = null;
  }
};

function main(metadata, orientation, panel_height, instance_id) {
  return new MyApplet(metadata, orientation, panel_height, instance_id);
}