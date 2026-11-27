import { definePluginApp } from '@get-bb/plugin-sdk/app';
import { AppearanceUI, Settings, mountHeadingAppearance } from './components/appearance-ui';
import { mountSidebarCollapse } from './lib/sidebar-collapse';
import './app.css';

export default definePluginApp(app=>{
 app.contentScripts.register({id:'heading-appearance',mount:mountHeadingAppearance});
 app.contentScripts.register({id:'sidebar-collapse',mount:()=>mountSidebarCollapse(document)});
 app.slots.experimental_appOverlay({id:'heading-editor',component:AppearanceUI});
 app.slots.settingsSection({id:'appearance',title:'Заголовки секций и проектов',component:Settings});
});
