package app.tabletopmobile;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // The back button/gesture never closes the app by itself: it is
        // forwarded to the page as a "tabletopback" event on `document`, and
        // the page decides (close a popup, go back to the menu, or minimize).
        // Registered after the plugins, so it takes precedence over them.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (bridge != null) {
                    bridge.triggerJSEvent("tabletopback", "document");
                }
            }
        });
    }
}
